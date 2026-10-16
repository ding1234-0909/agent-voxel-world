import { agentConfig } from '../apps/agent/src/cli/deepseek-config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderStore,
  validateAgent,
  validateProvider,
} from '../apps/server/src/agent/manager';
import {
  ModelPlanner,
  listModels,
  type Observation,
} from '@voxel/agent-runtime';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const provider = () =>
  validateProvider({
    name: 'Test',
    type: 'deepseek',
    apiKey: 'fixture-secret',
    defaultModel: 'deepseek-flash',
  });
describe('provider configuration boundary', () => {
  it('imports env once, persists privately, and never returns credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'voxel-providers-'));
    folders.push(dir);
    const path = join(dir, 'providers.json');
    const store = new ProviderStore(path);
    await store.load({ DEEPSEEK_API_KEY: 'fixture-secret' });
    expect(JSON.stringify(store.list())).not.toContain('fixture-secret');
    expect(store.list()[0].hasApiKey).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const saved = await store.save(
      { ...store.list()[0], name: 'Updated', apiKey: '' },
      'deepseek',
    );
    expect(saved.name).toBe('Updated');
    expect(store.get('deepseek').apiKey).toBe('fixture-secret');
    const reloaded = new ProviderStore(path);
    await reloaded.load({ DEEPSEEK_API_KEY: 'different' });
    expect(reloaded.get('deepseek').apiKey).toBe('fixture-secret');
    await Promise.all([
      store.save({ name: 'A', type: 'ollama' }),
      store.save({ name: 'B', type: 'ollama' }),
    ]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(4);
    await store.remove('ollama');
    expect(store.list()).toHaveLength(3);
  });
  it.each([
    'http://remote.example/v1',
    'https://user:password@example.com/v1',
    'https://example.com/v1?key=x',
    'file:///tmp/key',
  ])('rejects unsafe endpoint %s', (baseUrl) => {
    expect(() =>
      validateProvider({ name: 'Test', type: 'compatible', baseUrl }),
    ).toThrow();
  });
  it('does not forward saved credentials when changing origin or provider type', () => {
    const previous = provider();
    expect(() =>
      validateProvider(
        {
          ...previous,
          type: 'compatible',
          baseUrl: 'https://other.example/v1',
          apiKey: '',
        },
        previous,
      ),
    ).toThrow('重新填写');
    expect(
      validateProvider(
        {
          ...previous,
          type: 'compatible',
          baseUrl: 'https://other.example/v1',
          apiKey: 'new-secret',
        },
        previous,
      ).apiKey,
    ).toBe('new-secret');
  });
  it('bounds runtime settings and defaults to no block edits', () => {
    const p = provider();
    const input = { name: 'AI', goal: 'Observe' };
    expect(validateAgent(input, p)).toMatchObject({
      maxTurns: 100,
      allowEdits: false,
      model: 'deepseek-flash',
    });
    for (const invalid of [
      { maxTurns: 201 },
      { intervalMs: 0 },
      { allowEdits: 'true' },
      { reasoningEffort: ['high'] },
      { model: 'bad model' },
      { maxTokens: Infinity },
    ])
      expect(() => validateAgent({ ...input, ...invalid }, p)).toThrow();
    expect(() => validateAgent(input, { ...p, apiKey: '' })).toThrow('API Key');
    const local = validateProvider({
      name: 'Local',
      type: 'ollama',
      defaultModel: 'qwen3:8b',
    });
    expect(validateAgent(input, local).model).toBe('qwen3:8b');
    expect(() =>
      validateAgent({ ...input, thinking: 'enabled' }, local),
    ).toThrow();
  });
});
describe('multi-provider SDK requests', () => {
  it.each(['ollama', 'compatible'] as const)(
    'uses %s endpoint without DeepSeek-only parameters',
    async (type) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '{"type":"wait"}' },
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const endpoint = {
        type,
        baseUrl: 'http://127.0.0.1:11434/v1',
        jsonMode: false,
        tokenField: 'max_completion_tokens' as const,
      };
      const config = {
        ...agentConfig({ DEEPSEEK_API_KEY: 'fixture' }),
        model: 'org/model:8b',
      };
      const observation = {
        revision: 1,
        self: {},
        players: [],
        blocks: [],
        events: [],
        radius: 8,
      } as unknown as Observation;
      expect(
        await new ModelPlanner(config, request, endpoint).decide(
          observation,
          null,
          new AbortController().signal,
        ),
      ).toEqual({ type: 'wait' });
      const [url, init] = request.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({
        model: 'org/model:8b',
        max_completion_tokens: 512,
      });
      for (const key of [
        'max_tokens',
        'thinking',
        'reasoning_effort',
        'response_format',
      ])
        expect(body).not.toHaveProperty(key);
      expect(init?.redirect).toBe('error');
    },
  );
  it('discovers model IDs through the configured SDK endpoint', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }] }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    expect(await listModels(provider(), 'fixture', request)).toEqual([
      'a',
      'z',
    ]);
    expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
  });
});

describe('managed scheduling validation', () => {
  it('accepts continuous random scheduling and keeps old requests finite', () => {
    const base = { name: 'AI', goal: 'Observe' };
    expect(validateAgent(base, provider())).toMatchObject({
      continuous: false,
      intervalMode: 'fixed',
      maxTurns: 100,
    });
    expect(
      validateAgent(
        {
          ...base,
          continuous: true,
          intervalMode: 'random',
          intervalMinMs: 4000,
          intervalMaxMs: 8000,
        },
        provider(),
      ),
    ).toMatchObject({
      continuous: true,
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
    });
    for (const invalid of [
      { continuous: 'true' },
      { continuous: null },
      { intervalMode: 'bad' },
      { intervalMinMs: 8000, intervalMaxMs: 4000 },
      { intervalMinMs: 999 },
      { intervalMaxMs: 60001 },
      { intervalMinMs: 4000.5 },
    ])
      expect(() =>
        validateAgent({ ...base, ...invalid }, provider()),
      ).toThrow();
  });
});
