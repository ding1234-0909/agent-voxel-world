import { expect, it, vi } from 'vitest';
import { SpatialTranscriber } from '../apps/web/src/audio/spatial-transcriber';
import {
  LiveRecorder,
  type SpeechCapture,
} from '../apps/web/src/audio/live-recorder';
const flush = async () => {
  for (let i = 0; i < 18; i++) await Promise.resolve();
};
function setup() {
  let frame!: (pcm: Uint8Array) => void;
  const capture = {
    canRecord: true,
    start: vi.fn(
      async (
        callback: typeof frame,
        _ended: () => void,
        _stream?: MediaStream,
      ) => {
        frame = callback;
        return true;
      },
    ),
    stop: vi.fn(),
    finish: vi.fn(async () => {}),
  };
  let n = 0;
  const request = vi.fn(
    async (url: string, options: RequestInit) =>
      new Response(
        options.method === 'DELETE'
          ? null
          : JSON.stringify(
              url.endsWith('/start')
                ? { id: String(++n) }
                : { text: url.endsWith('/preview') ? '未确认' : '识别文字' },
            ),
        { status: options.method === 'DELETE' ? 204 : 200 },
      ),
  );
  const changed = vi.fn(),
    stream = {} as MediaStream;
  const transcriber = new SpatialTranscriber(
    () => 'token',
    changed,
    request as typeof fetch,
    new LiveRecorder(capture as unknown as SpeechCapture),
  );
  const feed = (count: number, loud = true) => {
    for (let i = 0; i < count; i++) {
      const pcm = new Uint8Array(3200);
      const view = new DataView(pcm.buffer);
      if (loud)
        for (let j = 0; j < pcm.length; j += 2) view.setInt16(j, 2000, true);
      frame(pcm);
    }
  };
  return { capture, request, changed, stream, transcriber, feed };
}
it('uses the existing microphone, previews locally and only publishes final sentences', async () => {
  const t = setup();
  await t.transcriber.start(t.stream);
  t.feed(12);
  await flush();
  expect(t.capture.start.mock.calls[0][2]).toBe(t.stream);
  await vi.waitFor(() =>
    expect(t.changed).toHaveBeenCalledWith(
      expect.objectContaining({ partial: '未确认', text: '' }),
    ),
  );
  expect(
    t.request.mock.calls.some(
      ([url, init]) => url.endsWith('/1') && init.method === 'POST',
    ),
  ).toBe(false);
  t.feed(9, false);
  await flush();
  await vi.waitFor(() =>
    expect(t.changed).toHaveBeenCalledWith(
      expect.objectContaining({ text: '识别文字' }),
    ),
  );
  t.transcriber.stop();
  expect(t.capture.stop).toHaveBeenCalled();
});
it('does not create tickets or infer on silence', async () => {
  const t = setup();
  await t.transcriber.start(t.stream);
  t.feed(100, false);
  await flush();
  expect(t.request).not.toHaveBeenCalled();
  t.transcriber.stop();
});
it('aborts in-flight recognition and ignores late results on stop', async () => {
  const t = setup();
  let resolve!: (r: Response) => void;
  let signal: AbortSignal | undefined;
  const normal = t.request.getMockImplementation()!;
  t.request.mockImplementation(async (url, options) => {
    if (options.body) {
      signal = options.signal as AbortSignal;
      return new Promise((r) => {
        resolve = r;
      });
    }
    return normal(url, options);
  });
  await t.transcriber.start(t.stream);
  t.feed(12);
  await flush();
  expect(signal).toBeDefined();
  t.transcriber.stop();
  expect(signal!.aborted).toBe(true);
  resolve(new Response(JSON.stringify({ text: 'late' })));
  await flush();
  expect(
    t.changed.mock.calls.some(
      ([state]) => state.text === 'late' || state.partial === 'late',
    ),
  ).toBe(false);
});
