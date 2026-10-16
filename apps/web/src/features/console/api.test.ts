import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consoleApi } from './api';
import { freshProvider, initialAgent } from './model';

const request = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('VITE_SERVER_URL', 'wss://world.example');
  vi.stubGlobal('fetch', request);
  request.mockImplementation(async () => new Response('{}'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  request.mockReset();
});

it('propagates cancellation to list and model requests, encoding provider IDs', async () => {
  const signal = new AbortController().signal;
  await consoleApi.listProviders(signal);
  await consoleApi.listAgents(signal);
  await consoleApi.listModels('custom/provider', signal);
  expect(
    request.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.signal,
      init?.body,
    ]),
  ).toEqual([
    ['https://world.example/agents/providers', 'GET', signal, undefined],
    ['https://world.example/agents', 'GET', signal, undefined],
    [
      'https://world.example/agents/providers/custom%2Fprovider/models',
      'GET',
      signal,
      undefined,
    ],
  ]);
});

it('keeps provider create, edit, key preservation and deletion contracts', async () => {
  const draft = freshProvider('compatible');
  await consoleApi.saveProvider(draft);
  await consoleApi.saveProvider(draft, 'provider/id');
  request.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(
    consoleApi.deleteProvider('provider/id'),
  ).resolves.toBeUndefined();
  expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
    ['https://world.example/agents/providers', 'POST'],
    ['https://world.example/agents/providers/provider%2Fid', 'PUT'],
    ['https://world.example/agents/providers/provider%2Fid', 'DELETE'],
  ]);
  const init = request.mock.calls[1][1]!;
  expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(init.body as string)).toEqual(draft);
  expect(JSON.parse(init.body as string).apiKey).toBe('');
});

it('keeps editing separate from creation and preserves explicit agent settings', async () => {
  const settings = {
    ...initialAgent,
    intervalMode: 'random' as const,
    intervalMinMs: 1200,
    intervalMaxMs: 8500,
    voiceReplies: false,
  };
  await consoleApi.saveAgent(settings);
  await consoleApi.saveAgent(settings, 'agent/id');
  expect(
    request.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      JSON.parse(init?.body as string),
    ]),
  ).toEqual([
    ['https://world.example/agents', 'POST', settings],
    ['https://world.example/agents/agent%2Fid', 'PUT', settings],
  ]);
});

it.each([
  ['resume', () => consoleApi.resumeAgent('a/b'), {}],
  ['pause', () => consoleApi.pauseAgent('a/b'), {}],
  ['cancel', () => consoleApi.cancelTask('a/b'), {}],
  ['stop', () => consoleApi.stopAgent('a/b'), {}],
  [
    'task',
    () => consoleApi.assignTask('a/b', '建造木屋'),
    { goal: '建造木屋' },
  ],
  ['voice', () => consoleApi.setVoiceReplies('a/b', false), { enabled: false }],
] as const)('sends %s as a scoped action', async (path, action, body) => {
  await action();
  expect(request).toHaveBeenCalledWith(
    `https://world.example/agents/a%2Fb/${path}`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
  );
});

it('preserves actionable errors for HTML responses and server rejections', async () => {
  request.mockResolvedValueOnce(
    new Response('<html>not found</html>', { status: 404 }),
  );
  await expect(consoleApi.listAgents()).rejects.toThrow('Agent 接口不可用');
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: '请先暂停任务' }), { status: 409 }),
  );
  await expect(consoleApi.saveAgent(initialAgent, 'busy')).rejects.toThrow(
    '请先暂停任务',
  );
});
