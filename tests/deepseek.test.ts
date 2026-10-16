import { describe, it, expect, vi } from 'vitest';
import {
  agentConfig,
  parseAction,
  parseDecision,
  DeepSeekPlanner,
  DeepSeekError,
  executeAction,
  runAgent,
  nextIntervalMs,
} from '../apps/agent/src/deepseek';
import type { Observation, Session } from '../apps/agent/src/session';
const config = () => ({
  ...agentConfig({ DEEPSEEK_API_KEY: 'test-key' }),
  intervalMs: 0,
  timeoutMs: 200,
});
const observation: Observation = {
  id: 'obs',
  revision: 94,
  radius: 8,
  allowedActions: ['move', 'chat', 'edit', 'observe'],
  self: {
    id: 'a',
    name: 'DeepSeek',
    kind: 'ai-agent',
    connected: true,
    x: 0,
    y: 2.5,
    z: 0,
    yaw: 0,
  },
  blocks: [],
  players: [],
  events: [],
};
const response = (content: string, finish_reason = 'stop') =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason, message: { content } }] }),
    { headers: { 'Content-Type': 'application/json' } },
  );
const signal = () => new AbortController().signal;
describe('DeepSeek agent boundary', () => {
  it('requires credentials and bounds the inference budget', () => {
    expect(() => agentConfig({})).toThrow('DEEPSEEK_API_KEY');
    expect(config()).toMatchObject({
      model: 'deepseek-flash',
      maxTurns: 100,
      allowEdits: false,
    });
    for (const env of [
      { AGENT_MAX_TURNS: '0' },
      { AGENT_MAX_TURNS: '201' },
      { AGENT_INTERVAL_MS: '10' },
      { AGENT_ALLOW_EDITS: 'yes' },
    ])
      expect(() => agentConfig({ DEEPSEEK_API_KEY: 'key', ...env })).toThrow();
  });
  it.each([
    null,
    [],
    { type: 'shell', command: 'rm -rf /' },
    { type: 'move', x: 99, z: 0, jump: false, durationMs: 100 },
    { type: 'move', x: 0, z: 0, jump: false, durationMs: 5000 },
    { type: 'move', x: NaN, z: 0, jump: false, durationMs: 100 },
    { type: 'chat', text: 'x'.repeat(241) },
    { type: 'edit', x: 0, y: 0, z: 0, material: null },
    { type: 'edit', x: 1, y: 3, z: 0, material: ['wood'] },
  ])('rejects untrusted action %j', (value) => {
    expect(() => parseAction(value, true)).toThrow();
  });
  it('enforces edit opt-in even for otherwise valid edits', () => {
    expect(() =>
      parseAction({ type: 'edit', x: 1, y: 3, z: 0, material: 'wood' }, false),
    ).toThrow('未开启');
    expect(parseAction({ type: 'wait', command: 'ignored' }, false)).toEqual({
      type: 'wait',
    });
  });
  it('uses official JSON mode and sends world observations without credentials in the prompt', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"type":"chat","text":"你好"}'));
    const planner = new DeepSeekPlanner(config(), request);
    expect(await planner.decide(observation, null, signal())).toEqual({
      type: 'chat',
      text: '你好',
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer test-key',
    );
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
      max_tokens: 512,
    });
    expect(JSON.stringify(body)).not.toContain('test-key');
    expect(JSON.parse(body.messages[1].content).observation.revision).toBe(94);
  });
  it('passes DeepSeek thinking and high reasoning effort through the OpenAI SDK', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"type":"wait"}'));
    const cfg = agentConfig({
      DEEPSEEK_API_KEY: 'key',
      DEEPSEEK_THINKING: 'enabled',
      DEEPSEEK_REASONING_EFFORT: 'high',
    });
    await new DeepSeekPlanner(cfg, request).decide(observation, null, signal());
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      max_tokens: 4096,
    });
  });
  it.each([
    ['', 'stop'],
    ['{"type":', 'length'],
    ['not json', 'stop'],
    ['{"type":"shell"}', 'stop'],
  ])('skips empty, truncated and invalid plans', async (text, reason) => {
    const planner = new DeepSeekPlanner(
      config(),
      vi.fn<typeof fetch>().mockResolvedValue(response(text, reason)),
    );
    await expect(planner.decide(observation, null, signal())).rejects.toThrow();
  });
  it('redacts upstream errors and treats bad credentials as fatal', async () => {
    const planner = new DeepSeekPlanner(
      config(),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('secret upstream test-key', { status: 401 }),
        ),
    );
    await expect(
      planner.decide(observation, null, signal()),
    ).rejects.toMatchObject({
      fatal: true,
      message: 'DeepSeek HTTP 401：API Key 无效。',
    });
  });
  it('aborts slow inference and never executes a late response after cancellation', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(Error('sensitive error')),
            { once: true },
          );
        }),
    );
    await expect(
      new DeepSeekPlanner(config(), request).decide(
        observation,
        null,
        signal(),
      ),
    ).rejects.toThrow('超时');
    const abort = new AbortController();
    abort.abort();
    const late = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"type":"wait"}'));
    await expect(
      new DeepSeekPlanner(config(), late).decide(
        observation,
        null,
        abort.signal,
      ),
    ).rejects.toThrow('已停止');
  });
});
describe('AI action execution', () => {
  function session() {
    return {
      move: vi.fn(),
      request: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'conflict', revision: 95 }),
      observe: vi.fn().mockResolvedValue(observation),
    };
  }
  it('uses observed revision for edits and returns server conflicts without replaying', async () => {
    const s = session();
    const result = await executeAction(
      s as unknown as Session,
      { type: 'edit', x: 1, y: 3, z: 0, material: 'wood' },
      observation,
      true,
      signal(),
    );
    expect(s.request).toHaveBeenCalledExactlyOnceWith('edit', {
      x: 1,
      y: 3,
      z: 0,
      material: 'wood',
      revision: 94,
    });
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    await expect(
      executeAction(
        s as unknown as Session,
        { type: 'edit', x: 1, y: 3, z: 0, material: null },
        observation,
        false,
        signal(),
      ),
    ).rejects.toThrow('未开启');
  });
  it('stops movement on cancellation', async () => {
    const s = session(),
      abort = new AbortController();
    const moving = executeAction(
      s as unknown as Session,
      { type: 'move', x: 1, z: 0, jump: false, durationMs: 1000 },
      observation,
      false,
      abort.signal,
    );
    abort.abort();
    await expect(moving).rejects.toThrow();
    expect(s.move.mock.calls).toEqual([
      [1, 0, false],
      [0, 0, false],
    ]);
  });
  it('caps model calls and supplies action results to the next decision', async () => {
    const s = session(),
      decide = vi.fn().mockResolvedValue({
        type: 'chat',
        text: '你好',
        task: { intent: 'continue', status: 'running', summary: '进行中' },
      });
    await runAgent(
      s as unknown as Session,
      { decide },
      { ...config(), maxTurns: 2 },
      signal(),
      () => {},
    );
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1][1]).toMatchObject({
      previous: {
        action: { type: 'chat' },
        result: { ok: false, error: 'conflict' },
      },
    });
  });
  it('stops after three provider failures without performing any actions', async () => {
    const s = session(),
      decide = vi
        .fn()
        .mockRejectedValue(new DeepSeekError('temporarily unavailable'));
    await expect(
      runAgent(
        s as unknown as Session,
        { decide },
        config(),
        signal(),
        () => {},
      ),
    ).rejects.toThrow('已停止');
    expect(decide).toHaveBeenCalledTimes(3);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.move).not.toHaveBeenCalled();
  });
});

describe('continuous and randomized scheduling', () => {
  it('supports explicit CLI scheduling settings while preserving finite defaults', () => {
    expect(config()).toMatchObject({
      continuous: false,
      intervalMode: 'fixed',
    });
    expect(
      agentConfig({
        DEEPSEEK_API_KEY: 'fixture',
        AGENT_CONTINUOUS: 'true',
        AGENT_INTERVAL_MODE: 'random',
        AGENT_INTERVAL_MIN_MS: '4000',
        AGENT_INTERVAL_MAX_MS: '8000',
      }),
    ).toMatchObject({
      continuous: true,
      intervalMode: 'random',
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
    });
    for (const env of [
      { AGENT_CONTINUOUS: 'yes' },
      { AGENT_INTERVAL_MODE: 'bad' },
      { AGENT_INTERVAL_MIN_MS: '9000', AGENT_INTERVAL_MAX_MS: '4000' },
      { AGENT_INTERVAL_MIN_MS: '0' },
    ])
      expect(() =>
        agentConfig({ DEEPSEEK_API_KEY: 'fixture', ...env }),
      ).toThrow();
  });
  it('samples inclusive random bounds and preserves fixed intervals', () => {
    const cfg = {
      ...config(),
      intervalMode: 'random' as const,
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
    };
    expect(nextIntervalMs(cfg, () => 0)).toBe(4000);
    expect(nextIntervalMs(cfg, () => 0.999999)).toBe(8000);
    expect(nextIntervalMs(cfg, () => 0.5)).toBe(6000);
    expect(
      nextIntervalMs({ ...cfg, intervalMinMs: 5000, intervalMaxMs: 5000 }),
    ).toBe(5000);
    expect(
      nextIntervalMs(
        { ...cfg, intervalMode: 'fixed', intervalMs: 3000 },
        () => 0.5,
      ),
    ).toBe(3000);
  });
  it('legacy continuous flag cannot bypass the task budget', async () => {
    const decide = vi.fn(async () => ({
      type: 'wait' as const,
      task: {
        intent: 'continue' as const,
        status: 'running' as const,
        summary: 'Next step',
      },
    }));
    await runAgent(
      { observe: async () => observation, move: vi.fn(), request: vi.fn() },
      { decide },
      { ...config(), continuous: true, maxTurns: 1 },
      signal(),
      () => {},
    );
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it('draws a fresh interval only between turns', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await runAgent(
        { observe: async () => observation, move: vi.fn(), request: vi.fn() },
        {
          decide: async () => ({
            type: 'wait',
            task: {
              intent: 'continue',
              status: 'running',
              summary: 'Next step',
            },
          }),
        },
        {
          ...config(),
          maxTurns: 3,
          intervalMode: 'random',
          intervalMinMs: 0,
          intervalMaxMs: 0,
        },
        signal(),
        () => {},
      );
      expect(random).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });
  it('interrupts a long randomized wait without starting another inference', async () => {
    const abort = new AbortController(),
      decide = vi.fn(async () => ({
        type: 'wait' as const,
        task: {
          intent: 'continue' as const,
          status: 'running' as const,
          summary: 'Next step',
        },
      }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      await runAgent(
        { observe: async () => observation, move: vi.fn(), request: vi.fn() },
        { decide },
        {
          ...config(),
          continuous: true,
          intervalMode: 'random',
          intervalMinMs: 60000,
          intervalMaxMs: 60000,
        },
        abort.signal,
        () => {
          timer = setTimeout(() => abort.abort(), 10);
        },
      );
      expect(Date.now() - started).toBeLessThan(1000);
      expect(decide).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  });
  it('still terminates continuous mode after repeated provider failures', async () => {
    const decide = vi.fn().mockRejectedValue(new DeepSeekError('unavailable'));
    await expect(
      runAgent(
        { observe: async () => observation, move: vi.fn(), request: vi.fn() },
        { decide },
        { ...config(), continuous: true },
        signal(),
        () => {},
      ),
    ).rejects.toThrow('已停止');
    expect(decide).toHaveBeenCalledTimes(3);
  });
});

describe('task decision output formats', () => {
  it('accepts the real DeepSeek action/task envelope and preserves private routing', async () => {
    const value = {
      task: {
        intent: 'reply',
        status: 'completed',
        summary: 'Answered greeting privately.',
      },
      action: {
        type: 'chat',
        text: '你好！',
        scope: 'private',
        recipients: ['human'],
      },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(JSON.stringify(value)));
    expect(
      await new DeepSeekPlanner(config(), request).decide(
        observation,
        null,
        signal(),
      ),
    ).toMatchObject({
      type: 'chat',
      text: '你好！',
      scope: 'private',
      recipients: ['human'],
      task: { intent: 'reply' },
    });
  });
  it('envelope parsing does not bypass action permissions or task validation', () => {
    expect(() =>
      parseDecision(
        {
          action: { type: 'edit', x: 1, y: 3, z: 1, material: 'wood' },
          task: {
            intent: 'task',
            status: 'running',
            summary: 'build',
            goal: 'house',
          },
        },
        false,
      ),
    ).toThrow('权限');
    expect(() =>
      parseDecision(
        {
          action: { type: 'shell' },
          task: { intent: 'reply', status: 'completed', summary: 'x' },
        },
        true,
      ),
    ).toThrow();
    expect(() =>
      parseDecision(
        {
          action: { type: 'wait' },
          task: { intent: 'unknown', status: 'running', summary: 'x' },
        },
        true,
      ),
    ).toThrow();
  });
});
