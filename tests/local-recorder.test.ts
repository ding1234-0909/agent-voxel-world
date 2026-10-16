import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalRecorder } from '../apps/web/src/audio/local-recorder';
class Recorder {
  static latest: Recorder;
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}
const callbacks = () => ({
  onState: vi.fn(),
  onText: vi.fn(),
  onError: vi.fn(),
});
function setup() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('MediaRecorder', Recorder);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ text: 'hello' })));
  vi.stubGlobal('fetch', fetcher);
  return {
    recorder: new LocalRecorder(),
    track,
    getUserMedia,
    stream,
    fetcher,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('local recorder lifecycle', () => {
  it('uploads captured audio on finish and releases the microphone', async () => {
    const { recorder, track, fetcher } = setup();
    const cb = callbacks();
    await recorder.start('en-US', cb);
    recorder.finish();
    await vi.waitFor(() => expect(cb.onText).toHaveBeenCalledWith('hello'));
    expect(track.stop).toHaveBeenCalled();
    expect(fetcher.mock.calls[0][0]).toContain('language=en');
    expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(Blob);
  });
  it('normalizes browser video MIME labels for audio-only WebM files', async () => {
    const { recorder, fetcher } = setup();
    const cb = callbacks();
    await recorder.transcribeFile(
      new File(['audio'], 'sample.webm', { type: 'video/webm' }),
      'en',
      cb,
    );
    expect(fetcher.mock.calls[0][1].headers['Content-Type']).toBe('audio/webm');
    expect(cb.onText).toHaveBeenCalledWith('hello');
  });
  it('cancels pending permission without keeping a microphone alive', async () => {
    const { recorder, track, getUserMedia, stream } = setup();
    const cb = callbacks();
    let resolve!: (s: unknown) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = recorder.start('zh-CN', cb);
    recorder.cancel();
    resolve(stream);
    await pending;
    expect(track.stop).toHaveBeenCalled();
    expect(cb.onText).not.toHaveBeenCalled();
  });
  it('aborts requests and ignores late transcription after cancel', async () => {
    const { recorder, fetcher } = setup();
    const cb = callbacks();
    let resolve!: (r: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = recorder.transcribeFile(
      new File(['audio'], 'x.wav', { type: 'audio/wav' }),
      'zh-CN',
      cb,
    );
    recorder.cancel();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify({ text: 'late' })));
    await pending;
    expect(cb.onText).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });
  it('reports permission failure and does not use browser online recognition', async () => {
    const { recorder, getUserMedia, fetcher } = setup();
    const cb = callbacks();
    getUserMedia.mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    await recorder.start('zh-CN', cb);
    expect(cb.onError).toHaveBeenCalledWith(
      expect.stringContaining('权限被拒绝'),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('ends recording at the duration limit', async () => {
    vi.useFakeTimers();
    const { recorder, track } = setup();
    const cb = callbacks();
    await recorder.start('zh-CN', cb);
    await vi.advanceTimersByTimeAsync(20000);
    expect(track.stop).toHaveBeenCalled();
    expect(cb.onText).toHaveBeenCalledWith('hello');
  });
  it('surfaces errors and rejects oversized files without upload', async () => {
    const { recorder, fetcher } = setup();
    const cb = callbacks();
    await recorder.transcribeFile(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.wav'),
      'zh',
      cb,
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: '没有检测到清晰声音' }), {
        status: 400,
      }),
    );
    await recorder.transcribeFile(
      new File(['x'], 'x.wav', { type: 'audio/wav' }),
      'zh',
      cb,
    );
    expect(cb.onError).toHaveBeenLastCalledWith('没有检测到清晰声音');
  });
});
