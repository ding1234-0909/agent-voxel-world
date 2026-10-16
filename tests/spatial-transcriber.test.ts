import { afterEach, expect, it, vi } from 'vitest';
import { SpatialTranscriber } from '../apps/web/src/audio/spatial-transcriber';
class Recorder {
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['speech']) });
    this.onstop?.();
  }
}
function setup(loud = true) {
  vi.useFakeTimers();
  const track = { stop: vi.fn() },
    stream = {
      active: true,
      getTracks: () => [track],
    } as unknown as MediaStream;
  vi.stubGlobal('MediaRecorder', Recorder);
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = async () => {};
      close = close;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData: (samples: Float32Array) =>
            samples.fill(loud ? 0.05 : 0),
        };
      }
    },
  );
  let n = 0;
  const request = vi.fn(
    async (url: string, options: RequestInit) =>
      new Response(
        options.method === 'DELETE'
          ? null
          : JSON.stringify(
              url.endsWith('/start')
                ? { id: String(++n) }
                : { text: '识别文字' },
            ),
        { status: options.method === 'DELETE' ? 204 : 200 },
      ),
  );
  const changed = vi.fn(),
    transcriber = new SpatialTranscriber(
      () => 'token',
      changed,
      request as typeof fetch,
    );
  return { transcriber, changed, request, stream, track, close };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('segments live audio, posts ordered transcripts and never acquires another mic', async () => {
  const t = setup();
  await t.transcriber.start(t.stream);
  await vi.advanceTimersByTimeAsync(6200);
  const upload = t.request.mock.calls.find(([, options]) => options.body);
  expect(upload?.[1].body).toBeInstanceOf(Blob);
  expect(t.changed).toHaveBeenCalledWith(
    expect.objectContaining({ text: '识别文字' }),
  );
  t.transcriber.stop();
  expect(t.close).toHaveBeenCalled();
  expect(t.track.stop).not.toHaveBeenCalled();
});
it('drops silent segments without invoking transcription', async () => {
  const t = setup(false);
  await t.transcriber.start(t.stream);
  await vi.advanceTimersByTimeAsync(6200);
  expect(t.request.mock.calls.some(([, options]) => options.body)).toBe(false);
  expect(
    t.request.mock.calls.some(([, options]) => options.method === 'DELETE'),
  ).toBe(true);
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
      return new Promise((r) => (resolve = r));
    }
    return normal(url, options);
  });
  await t.transcriber.start(t.stream);
  await vi.advanceTimersByTimeAsync(6200);
  expect(signal).toBeDefined();
  t.transcriber.stop();
  expect(signal?.aborted).toBe(true);
  resolve(new Response(JSON.stringify({ text: 'late text' })));
  await vi.advanceTimersByTimeAsync(100);
  expect(
    t.changed.mock.calls.some(([state]) => state.text === 'late text'),
  ).toBe(false);
});

it('calls browser fetch without binding it to the transcriber instance', async () => {
  const t = setup();
  vi.stubGlobal(
    'fetch',
    function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this instanceof SpatialTranscriber)
        throw new TypeError('Illegal invocation');
      return t.request(String(input), init!);
    },
  );
  const transcriber = new SpatialTranscriber(() => 'token', t.changed);
  await transcriber.start(t.stream);
  await vi.advanceTimersByTimeAsync(6200);
  expect(t.changed).toHaveBeenCalledWith(
    expect.objectContaining({ text: '识别文字' }),
  );
  transcriber.stop();
});
