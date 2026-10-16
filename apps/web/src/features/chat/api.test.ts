import { afterEach, expect, it, vi } from 'vitest';
import { chatApi } from './api';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('uploads raw audio with the current chat token, audience and abort signal', async () => {
  vi.stubEnv('VITE_SERVER_URL', 'ws://127.0.0.1:9999');
  const request = vi.fn(
    async () => new Response(JSON.stringify({ transcriptAvailable: true })),
  );
  vi.stubGlobal('fetch', request);
  const clip = new Blob(['audio'], { type: 'audio/webm' });
  const signal = new AbortController().signal;
  await expect(
    chatApi.uploadAudio(clip, 'private', ['a', 'b'], 'current-token', signal),
  ).resolves.toEqual({ transcriptAvailable: true });
  expect(request).toHaveBeenCalledWith(
    'http://127.0.0.1:9999/chat/audio?scope=private&to=a%2Cb&language=zh',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        Authorization: 'Bearer current-token',
      },
      body: clip,
      signal,
    },
  );
});

it('rejects expired audio and an aborted download after bytes arrive', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response('audio'));
  vi.stubGlobal('fetch', request);
  const abort = new AbortController();
  await expect(
    chatApi.downloadAudio('clip', 'token', abort.signal),
  ).rejects.toThrow('语音已过期或无法访问');
  abort.abort();
  await expect(
    chatApi.downloadAudio('clip', 'new-token', abort.signal),
  ).rejects.toThrow('已取消加载');
  expect(request.mock.calls[1][1].headers.Authorization).toBe(
    'Bearer new-token',
  );
});

it('surfaces server upload failures without reporting successful delivery', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: '接收者已离线' }), {
          status: 400,
        }),
    ),
  );
  await expect(
    chatApi.uploadAudio(
      new Blob(),
      'private',
      ['offline'],
      'token',
      new AbortController().signal,
    ),
  ).rejects.toThrow('接收者已离线');
});
