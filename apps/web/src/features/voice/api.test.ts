import { afterEach, expect, it, vi } from 'vitest';
import { voiceApi } from './api';
afterEach(() => vi.unstubAllGlobals());
it('rejects malformed capabilities instead of advertising local speech readiness', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ local: { available: 'yes' } })),
    ),
  );
  await expect(
    voiceApi.capabilities(new AbortController().signal),
  ).rejects.toThrow('capabilities');
});
it('preserves readiness and cancellation at the request boundary', async () => {
  const data = {
    local: { available: false, reason: 'missing-model' },
    ollamaConfigured: true,
  };
  const request = vi.fn(async () => new Response(JSON.stringify(data)));
  vi.stubGlobal('fetch', request);
  const signal = new AbortController().signal;
  await expect(voiceApi.capabilities(signal)).resolves.toEqual(data);
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining('/voice/capabilities'),
    { signal },
  );
});
