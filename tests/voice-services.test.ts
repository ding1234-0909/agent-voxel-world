import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  VoiceServiceStore,
  validateVoiceService,
} from '../apps/server/src/audio/voice-services';
import { AgentSpeech } from '../apps/server/src/agent/speech';
import { RemoteTts } from '../apps/server/src/audio/remote-tts';
import { LocalTts } from '../apps/server/src/audio/local-tts';
import type { Player } from '../packages/shared/src';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-services-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const local = (name = 'Local', voice = '') => ({
  name,
  type: 'local',
  voice,
  speed: 1,
});
const remote = {
  name: 'Cloud',
  type: 'compatible',
  baseUrl: 'https://speech.example/v1',
  model: 'test-tts',
  voice: 'alloy',
  speed: 1,
  apiKey: 'secret-for-test',
};
const wav = () => {
  const b = Buffer.alloc(32044);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(32000, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(1000, i);
  return b;
};
it('persists multiple configurations privately, masks credentials, and preserves a blank key on edit', async () => {
  const store = new VoiceServiceStore(join(dir, 'voices.json'));
  await store.load();
  const cloud = await store.save(remote);
  const localVoice = await store.save(local('中文', 'Tingting'));
  expect(JSON.stringify(store.list())).not.toContain(remote.apiKey);
  expect(cloud.hasApiKey).toBe(true);
  await store.save({ ...cloud, apiKey: '', name: 'Renamed' }, cloud.id);
  expect(store.get(cloud.id).apiKey).toBe(remote.apiKey);
  const restored = new VoiceServiceStore(store.path);
  await restored.load();
  expect(restored.list()).toHaveLength(3);
  expect(restored.get(localVoice.id).voice).toBe('Tingting');
  expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(store.path, 'utf8'))).toHaveLength(3);
});
it('rejects credential reuse for a different endpoint and invalid configuration', () => {
  const saved = validateVoiceService(remote);
  expect(() =>
    validateVoiceService(
      { ...remote, baseUrl: 'https://other.example/v1', apiKey: '' },
      saved,
    ),
  ).toThrow('重新填写');
  for (const baseUrl of [
    'http://remote.example/v1',
    'https://user:password@example.com',
    'file:///tmp/a',
    'https://example.com?key=x',
  ])
    expect(() => validateVoiceService({ ...remote, baseUrl })).toThrow();
  expect(() => validateVoiceService({ ...local(), speed: NaN })).toThrow();
  expect(() => validateVoiceService({ ...remote, type: 'bailian' })).toThrow(
    '官方接口',
  );
});
it('rejects deletion of referenced services and validates bindings before changing them', async () => {
  const store = new VoiceServiceStore(join(dir, 'voices.json'));
  await store.load();
  await expect(store.remove('local-default', () => true)).rejects.toThrow(
    '引用',
  );
  store.bind('actor', 'local-default');
  await expect(store.remove('local-default', () => false)).rejects.toThrow(
    '引用',
  );
  expect(() => store.bind('actor', 'missing')).toThrow();
  store.unbind('actor');
  await store.remove('local-default', () => false);
  expect(store.list()).toEqual([]);
});
it('keeps unmanaged world clients on local TTS even if the initial profile becomes a cloud service', async () => {
  const store = new VoiceServiceStore(join(dir, 'voices.json'));
  await store.load();
  await store.save(remote, 'local-default');
  expect(store.forActor('unmanaged-client')).toBeInstanceOf(LocalTts);
});
it('routes previews and different actors through the saved voice and speed, never by a client payload', async () => {
  const calls: string[] = [];
  const store = new VoiceServiceStore(join(dir, 'voices.json'), (config) => ({
    synthesize: async (text) => {
      calls.push(`${config.voice}:${config.speed}:${text}`);
      return { bytes: wav(), durationMs: 1000 };
    },
  }));
  await store.load();
  const a = await store.save({ ...local('A', 'Tingting'), speed: 0.8 });
  const b = await store.save(local('B', 'Samantha'));
  store.bind('a', a.id);
  store.bind('b', b.id);
  await store.synthesize(a.id, 'Preview', new AbortController().signal);
  await store.forActor('a').synthesize('Agent A', new AbortController().signal);
  await store.forActor('b').synthesize('Agent B', new AbortController().signal);
  expect(calls).toEqual([
    'Tingting:0.8:Preview',
    'Tingting:0.8:Agent A',
    'Samantha:1:Agent B',
  ]);
  store.bind('b', '');
  await expect(
    store.forActor('b').synthesize('Disabled', new AbortController().signal),
  ).rejects.toThrow();
});
it('cancels old synthesis and private clips when a service binding changes', async () => {
  let finish!: (value: { bytes: Buffer; durationMs: number }) => void;
  let signal!: AbortSignal;
  const store = new VoiceServiceStore(join(dir, 'voices.json'), () => ({
    synthesize: async (_text, abort) => {
      signal = abort;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  }));
  await store.load();
  const second = await store.save(local('second'));
  store.bind('ai', 'local-default');
  const players: Player[] = [
    {
      id: 'ai',
      kind: 'ai-agent',
      name: 'AI',
      connected: true,
      voiceReplies: true,
      x: 0,
      y: 2,
      z: 0,
      yaw: 0,
    },
    {
      id: 'human',
      kind: 'human',
      name: 'Human',
      connected: true,
      voiceListening: true,
      x: 0,
      y: 2,
      z: -2,
      yaw: 0,
    },
  ];
  const notify = vi.fn();
  const speech = new AgentSpeech(
    () => players,
    notify,
    vi.fn(),
    (actor) => store.forActor(actor),
  );
  const unsubscribe = store.onChange((actor) => speech.cancel(actor));
  speech.enqueue('ai', {
    kind: 'text',
    scope: 'private',
    recipients: ['human'],
    text: 'Hello',
    name: 'AI',
  });
  store.bind('ai', second.id);
  expect(signal.aborted).toBe(true);
  finish({ bytes: wav(), durationMs: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
  speech.close();
});
it('cancels previews and bounds concurrent synthesis', async () => {
  const pending: (() => void)[] = [];
  const store = new VoiceServiceStore(join(dir, 'voices.json'), () => ({
    synthesize: async () => {
      await new Promise<void>((resolve) => pending.push(resolve));
      return { bytes: wav(), durationMs: 1000 };
    },
  }));
  await store.load();
  const abort = new AbortController();
  const first = store.synthesize('local-default', 'one', abort.signal);
  const second = store.synthesize(
    'local-default',
    'two',
    new AbortController().signal,
  );
  await expect(
    store.synthesize('local-default', 'three', new AbortController().signal),
  ).rejects.toThrow('繁忙');
  abort.abort();
  pending.forEach((resolve) => resolve());
  await expect(first).rejects.toThrow();
  await second;
});
it('sends compatible TTS parameters and handles real WAV response without exposing keys', async () => {
  const request = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array(wav())),
  );
  const config = validateVoiceService(remote);
  const audio = await new RemoteTts(config, request).synthesize(
    'hello',
    new AbortController().signal,
  );
  expect(audio.durationMs).toBe(1000);
  expect(request.mock.calls[0][0]).toBe(
    'https://speech.example/v1/audio/speech',
  );
  const init = request.mock.calls[0][1]!;
  expect(init.redirect).toBe('error');
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'test-tts',
    input: 'hello',
    voice: 'alloy',
    speed: 1,
    response_format: 'wav',
  });
});
it('fetches Bailian audio only from its output hosts and never forwards the API key to storage', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        output: {
          audio: {
            url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?signature=test',
          },
        },
      }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(wav())));
  const config = validateVoiceService({
    ...remote,
    type: 'bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'qwen3-tts-flash',
    voice: 'Cherry',
  });
  await new RemoteTts(config, request).synthesize(
    '你好',
    new AbortController().signal,
  );
  expect(JSON.parse(request.mock.calls[0][1]!.body as string).input).toEqual({
    text: '你好',
    voice: 'Cherry',
    language_type: 'Auto',
  });
  expect(String(request.mock.calls[1][0])).toMatch(/^https:/);
  expect(request.mock.calls[1][1]?.headers).toBeUndefined();
  request
    .mockReset()
    .mockResolvedValueOnce(
      Response.json({ output: { audio: { url: 'http://127.0.0.1/private' } } }),
    );
  await expect(
    new RemoteTts(config, request).synthesize(
      'hi',
      new AbortController().signal,
    ),
  ).rejects.toThrow('音频地址');
  expect(request).toHaveBeenCalledOnce();
});
