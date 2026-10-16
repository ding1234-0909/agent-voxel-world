import { describe, expect, it, vi } from 'vitest';
import { AgentAttention } from '../apps/agent/src/attention';
import { agentConfig, type AgentDecision } from '../apps/agent/src/deepseek';
import {
  newTask,
  runTaskStep,
  parseTaskDirective,
  type AgentRunState,
} from '../apps/agent/src/task-runtime';
import type { Session, Observation } from '../apps/agent/src/session';

const cfg = () => ({
  ...agentConfig({ DEEPSEEK_API_KEY: 'fixture' }),
  allowEdits: true,
  maxTurns: 30,
  timeoutMs: 1000,
});
function fixture() {
  const observation: Observation = {
    id: 'obs',
    self: {
      id: 'ai',
      name: 'Agent',
      kind: 'ai-agent',
      connected: true,
      x: 0,
      y: 2.5,
      z: 0,
      yaw: 0,
    },
    revision: 1,
    radius: 8,
    blocks: [],
    players: [],
    events: [],
    allowedActions: [],
  };
  const session = {
    observe: vi.fn(async () => structuredClone(observation)),
    request: vi.fn(async () => ({ ok: true, revision: 1, id: 'result' })),
    move: vi.fn(),
  };
  const memory: AgentRunState = {};
  const attention = new AgentAttention();
  const planner = {
    decide: vi.fn<(...args: any[]) => Promise<AgentDecision>>(),
    lastUsage: { tokens: 100, estimated: false },
  };
  let seq = 0;
  const message = (text = '你好', scope = 'private', actor = 'human') =>
    attention.push(
      {
        seq: ++seq,
        at: Date.now(),
        type: 'chat',
        actor,
        actorKind: 'human',
        data: { kind: 'text', scope, recipients: ['ai'], name: 'Player', text },
      },
      'ai',
    );
  const step = (config = cfg(), signal = new AbortController().signal) =>
    runTaskStep(
      session as unknown as Session,
      planner,
      config,
      signal,
      memory,
      attention,
    );
  return { observation, session, memory, attention, planner, message, step };
}
const decision = (
  intent = 'continue',
  status = 'running',
  extra = {},
): AgentDecision =>
  ({
    type: 'wait',
    task: { intent, status, summary: '进展记录', ...extra },
  }) as AgentDecision;

describe('task-driven wake decisions', () => {
  it('a private greeting costs one call even with 30-call limit, and cannot restart a completed task', async () => {
    const f = fixture();
    f.memory.task = { ...newTask('Build house'), status: 'completed' };
    f.message();
    f.planner.decide.mockResolvedValue({
      type: 'chat',
      text: '你好',
      task: { intent: 'reply', status: 'completed', summary: '已回复' },
    });
    await f.step();
    for (let i = 0; i < 30; i++) await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(1);
    expect(f.memory.task.status).toBe('completed');
    expect(f.session.request).toHaveBeenCalledExactlyOnceWith(
      'chat',
      expect.objectContaining({ scope: 'private', recipients: ['human'] }),
    );
    expect(f.memory.usage).toEqual({ calls: 1, tokens: 100, estimated: false });
  });
  it('explicit task runs only as far as useful, verifies an action before completion, then stops polling', async () => {
    const f = fixture();
    f.message('放一块木头');
    f.planner.decide
      .mockResolvedValueOnce({
        type: 'edit',
        x: 1,
        y: 3,
        z: 0,
        material: 'wood',
        task: {
          intent: 'task',
          status: 'completed',
          goal: '放一块木头',
          summary: '尝试放置',
        },
      })
      .mockResolvedValueOnce({
        type: 'chat',
        text: '已经放好了',
        task: {
          intent: 'continue',
          status: 'completed',
          summary: '已观察确认方块',
        },
      });
    await f.step();
    expect(f.memory.task?.status).toBe('running');
    f.observation.blocks.push({ x: 1, y: 3, z: 0, material: 'wood' });
    await f.step();
    await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(2);
    expect(f.planner.decide.mock.calls[1][1].previous.result.ok).toBe(true);
    expect(f.memory.task).toMatchObject({ status: 'completed', calls: 2 });
    expect(f.session.request).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({ scope: 'private', recipients: ['human'] }),
    );
  });
  it('public status questions preserve private task progress without exposing its context', async () => {
    const f = fixture();
    f.memory.task = newTask('private secret', 'human', 'human');
    f.memory.previous = { secret: true };
    f.message('在做什么', 'public', 'other');
    f.planner.decide.mockResolvedValue(decision('reply', 'completed'));
    await f.step();
    expect(f.planner.decide.mock.calls[0][1].task).toBeUndefined();
    expect(f.planner.decide.mock.calls[0][1].previous).toBeUndefined();
    expect(f.memory.previous).toEqual({ secret: true });
    expect(f.memory.task.status).toBe('running');
    expect(f.memory.task.calls).toBe(0);
  });
  it('task update retains previous action context and unfinished plan', async () => {
    const f = fixture();
    f.memory.task = newTask('build house', 'human', 'human');
    f.memory.previous = { progress: 12 };
    f.message('门朝东');
    f.planner.decide.mockResolvedValue(
      decision('update', 'running', { goal: 'build house, door east' }),
    );
    await f.step();
    expect(f.planner.decide.mock.calls[0][1].previous).toEqual({
      progress: 12,
    });
    expect(f.memory.task).toMatchObject({
      goal: 'build house, door east',
      status: 'running',
    });
  });
  it('unchanged waiting polls avoid inference; a relevant local world change wakes once', async () => {
    const f = fixture();
    f.memory.task = newTask('waiting');
    f.planner.decide
      .mockResolvedValueOnce(
        decision('continue', 'waiting', { waitFor: 'world' }),
      )
      .mockResolvedValueOnce(decision('continue', 'completed'));
    await f.step();
    await f.step();
    await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(1);
    f.observation.blocks.push({ x: 1, y: 3, z: 1, material: 'wood' });
    await f.step();
    await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(2);
  });
  it('needs_input and blocked states do not loop and a human update can unblock', async () => {
    const f = fixture();
    f.memory.task = newTask('build');
    f.planner.decide
      .mockResolvedValueOnce(decision('continue', 'needs_input'))
      .mockResolvedValueOnce(
        decision('update', 'running', { goal: 'build at east' }),
      );
    await f.step();
    await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(1);
    f.message('在东边');
    await f.step();
    expect(f.memory.task?.status).toBe('running');
  });
  it('budget guards still apply to legacy continuous mode and ordinary chat cannot reset them', async () => {
    const f = fixture();
    f.memory.task = newTask('forever');
    f.planner.decide.mockResolvedValue(decision());
    await f.step({ ...cfg(), maxTurns: 1, continuous: true });
    expect(f.memory.task.status).toBe('budget');
    f.message();
    f.planner.decide.mockResolvedValue(decision('reply', 'completed'));
    await f.step({ ...cfg(), maxTurns: 1 });
    await f.step({ ...cfg(), maxTurns: 1 });
    expect(f.planner.decide).toHaveBeenCalledTimes(2);
    expect(f.memory.task.status).toBe('budget');
    expect(f.memory.task.calls).toBe(1);
  });
  it('token exhaustion and time exhaustion stop further model calls', async () => {
    for (const task of [{ tokens: 1000 }, { elapsedMs: 1000 }]) {
      const f = fixture();
      f.memory.task = { ...newTask('build'), ...task };
      await f.step({ ...cfg(), tokenBudget: 1000, taskTimeoutMs: 1000 });
      expect(f.memory.task.status).toBe('budget');
      expect(f.planner.decide).not.toHaveBeenCalled();
    }
  });
  it('repeated no-progress decisions stop instead of consuming the remaining 30 calls', async () => {
    const f = fixture();
    f.memory.task = newTask('stuck');
    f.planner.decide.mockResolvedValue(decision());
    for (let i = 0; i < 10; i++) await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(4);
    expect(f.memory.task.status).toBe('blocked');
  });
  it('cannot attach destructive action to a greeting or create a task from an automatic poll', async () => {
    const f = fixture();
    f.message();
    f.planner.decide.mockResolvedValue({
      type: 'edit',
      x: 1,
      y: 3,
      z: 1,
      material: null,
      task: { intent: 'reply', status: 'completed', summary: 'bad' },
    });
    await f.step();
    expect(f.session.request).toHaveBeenCalledExactlyOnceWith(
      'chat',
      expect.objectContaining({
        scope: 'private',
        text: expect.stringContaining('处理失败'),
      }),
    );
    f.memory.task = newTask('old');
    f.planner.decide.mockResolvedValue(
      decision('task', 'running', { goal: 'new' }),
    );
    await f.step();
    expect(f.memory.task.goal).toBe('old');
  });
  it('pause/cancel actions preserve the character and stop autonomous work', async () => {
    for (const intent of ['pause', 'cancel'] as const) {
      const f = fixture();
      f.memory.task = newTask('build', 'human');
      f.message(intent);
      f.planner.decide.mockResolvedValue(decision(intent, 'completed'));
      await f.step();
      await f.step();
      expect(f.memory.task.status).toBe(
        intent === 'pause' ? 'paused' : 'cancelled',
      );
      expect(f.planner.decide).toHaveBeenCalledTimes(1);
      expect(f.session.move).not.toHaveBeenCalled();
    }
  });
  it('drops a late model action after cancellation and still accounts for the request', async () => {
    const f = fixture(),
      abort = new AbortController();
    f.memory.task = newTask('build');
    f.planner.decide.mockImplementation(async () => {
      abort.abort();
      return { type: 'edit', x: 1, y: 3, z: 1, material: 'wood' };
    });
    await f.step(cfg(), abort.signal);
    expect(f.session.request).not.toHaveBeenCalled();
    expect(f.memory.usage?.calls).toBe(1);
  });
  it('nearby human speech wakes once without replaying old observation chat', async () => {
    const f = fixture();
    f.message('你好', 'nearby');
    f.planner.decide.mockResolvedValue({ type: 'chat', text: '你好' });
    await f.step();
    await f.step();
    expect(f.planner.decide).toHaveBeenCalledTimes(1);
    expect(f.session.request).toHaveBeenLastCalledWith(
      'chat',
      expect.objectContaining({ scope: 'private' }),
    );
  });
  it('rejects invalid task directives instead of granting unbounded actions', () => {
    expect(() =>
      parseTaskDirective({ intent: 'task', status: 'running', summary: 'x' }),
    ).toThrow();
    expect(() =>
      parseTaskDirective({
        intent: 'continue',
        status: 'waiting',
        summary: 'x',
      }),
    ).toThrow();
    expect(() =>
      parseTaskDirective({ intent: 'shell', status: 'running', summary: 'x' }),
    ).toThrow();
  });
});

it('reconciles a resumed blueprint against observed blocks before claiming completion', async () => {
  const f = fixture();
  f.memory.task = newTask('finish house');
  const block = { x: 1, y: 3, z: 1, material: 'wood' as const };
  f.memory.unfinishedBuild = {
    action: { type: 'build', blocks: [block] },
    result: {
      ok: false,
      total: 1,
      completed: 0,
      skipped: 0,
      remaining: [block],
      failures: [],
      note: 'paused',
    },
  };
  f.observation.blocks.push(block);
  f.planner.decide.mockResolvedValue(decision('continue', 'completed'));
  await f.step();
  expect(f.memory.unfinishedBuild).toBeUndefined();
  expect(f.memory.task.status).toBe('completed');
});
it('does not send a false completion report while a blueprint still has missing blocks', async () => {
  const f = fixture();
  f.memory.task = newTask('finish house');
  const block = { x: 1, y: 3, z: 1, material: 'wood' as const };
  f.memory.unfinishedBuild = {
    action: { type: 'build', blocks: [block] },
    result: {
      ok: false,
      total: 1,
      completed: 0,
      skipped: 0,
      remaining: [block],
      failures: [],
      note: 'paused',
    },
  };
  f.planner.decide.mockResolvedValue({
    type: 'chat',
    text: '全部完成',
    task: { intent: 'continue', status: 'completed', summary: 'done' },
  });
  await f.step();
  expect(f.memory.task.status).toBe('blocked');
  expect(f.session.request).toHaveBeenCalledWith(
    'chat',
    expect.objectContaining({ text: expect.stringContaining('未确认完成') }),
  );
});

it('reports failed addressed decisions privately and leaves the previous task intact', async () => {
  const f = fixture();
  f.memory.task = {
    ...newTask('Existing house'),
    status: 'waiting',
    waitFor: 'world',
  };
  const task = structuredClone(f.memory.task);
  f.message('到我这里来', 'public');
  f.planner.decide.mockRejectedValueOnce(new Error('malformed decision'));
  await f.step();
  expect(f.session.request).toHaveBeenCalledExactlyOnceWith('chat', {
    text: expect.stringContaining('处理失败'),
    scope: 'private',
    recipients: ['human'],
  });
  expect(f.memory.task).toEqual(task);
  expect(f.memory.usage?.calls).toBe(1);
  f.message('你好', 'public');
  f.planner.decide.mockResolvedValueOnce({
    type: 'chat',
    text: '你好',
    task: { intent: 'reply', status: 'completed', summary: '已回复' },
  });
  await f.step();
  expect(f.planner.decide).toHaveBeenCalledTimes(2);
  expect(f.session.request).toHaveBeenLastCalledWith('chat', { text: '你好' });
});

it('acknowledges a movement task and verifies position without waiting for block changes', async () => {
  const f = fixture();
  f.message('到我这里来', 'public');
  f.planner.decide.mockResolvedValueOnce({
    type: 'move',
    x: 1,
    z: 0,
    jump: false,
    durationMs: 100,
    task: {
      intent: 'task',
      goal: '走到玩家身边',
      status: 'waiting',
      waitFor: 'world',
      summary: '正在靠近，稍后确认位置',
    },
  });
  await f.step();
  expect(f.session.move).toHaveBeenCalledWith(1, 0, false);
  expect(f.memory.task?.status).toBe('running');
  expect(f.session.request).toHaveBeenCalledWith(
    'chat',
    expect.objectContaining({
      text: expect.stringContaining('收到'),
      recipients: ['human'],
      scope: 'private',
    }),
  );
  f.observation.self.x = 1;
  f.planner.decide.mockResolvedValueOnce({
    type: 'chat',
    text: '已经到你身边了',
    task: { intent: 'continue', status: 'completed', summary: '已确认到达' },
  });
  await f.step();
  await f.step();
  expect(f.planner.decide).toHaveBeenCalledTimes(2);
  expect(f.memory.task?.status).toBe('completed');
});

it('accepts null optional task fields but still requires a goal and wait condition when applicable', () => {
  expect(
    parseTaskDirective({
      intent: 'reply',
      status: 'completed',
      summary: '回复',
      goal: null,
      waitFor: null,
    }),
  ).toMatchObject({ intent: 'reply', goal: undefined, waitFor: undefined });
  expect(() =>
    parseTaskDirective({
      intent: 'task',
      status: 'running',
      summary: '执行',
      goal: null,
    }),
  ).toThrow();
  expect(() =>
    parseTaskDirective({
      intent: 'continue',
      status: 'waiting',
      summary: '等待',
      waitFor: null,
    }),
  ).toThrow();
});

it('treats a repeated identical task as continuation without resetting its owner, progress or budget', async () => {
  const f = fixture();
  f.memory.task = {
    ...newTask('走到玩家身边', 'human', 'human'),
    calls: 5,
    tokens: 500,
  };
  f.memory.previous = { action: { type: 'move' }, result: { ok: true } };
  f.planner.decide.mockResolvedValue(
    decision('task', 'running', { goal: '走到玩家身边' }),
  );
  await f.step();
  expect(f.memory.task).toMatchObject({
    goal: '走到玩家身边',
    owner: 'human',
    privateTo: 'human',
    calls: 6,
    tokens: 600,
    status: 'running',
  });
  expect(f.memory.decisionError).toBeUndefined();
});

it('reports the rejected intent to the next decision without changing the task or leaking raw errors', async () => {
  const f = fixture();
  f.memory.task = newTask('走到玩家身边');
  f.planner.decide.mockResolvedValueOnce(
    decision('task', 'running', { goal: 'different goal' }),
  );
  await f.step();
  expect(f.memory.lastResponse).toContain('intent=continue');
  expect(f.memory.task.goal).toBe('走到玩家身边');
  f.planner.decide.mockImplementationOnce(async (_observation, context) => {
    expect(context.decisionError).toContain('intent=continue');
    return decision('continue', 'completed');
  });
  await f.step();
  expect(f.memory.task.status).toBe('completed');
  expect(f.memory.decisionError).toBeUndefined();
});
