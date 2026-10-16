import { afterEach, expect, it, vi } from 'vitest';
import {
  SpeechCapture,
  LiveRecorder,
  type LiveRecordingEvents,
} from '../apps/web/src/audio/live-recorder';
const events = (): LiveRecordingEvents => ({
  onState: vi.fn(),
  onStatus: vi.fn(),
  onPartial: vi.fn(),
  onFinal: vi.fn(),
  onError: vi.fn(),
  onEnd: vi.fn(),
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup() {
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const media = vi.fn(async () => stream),
    close = vi.fn(async () => {});
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  const node: any = {
    connect: () => node,
    disconnect: vi.fn(),
    gain: { value: 1 },
    port: {
      onmessage: null,
      postMessage: vi.fn(() => {
        node.port.onmessage?.({ data: new Uint8Array(1600).buffer });
        node.port.onmessage?.({ data: { flushed: true } });
      }),
    },
  };
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor() {
        return node;
      }
    },
  );
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = { addModule: vi.fn(async () => {}) };
      destination = {};
      resume = async () => {};
      close = close;
      createGain = () => node;
      createMediaStreamSource = () => node;
    },
  );
  return { stream, track, media, close, node };
}
afterEach(() => vi.unstubAllGlobals());
it('releases a microphone granted after cancellation without starting recognition', async () => {
  const t = setup();
  let grant!: (s: MediaStream) => void;
  t.media.mockImplementationOnce(
    () =>
      new Promise((r) => {
        grant = r;
      }),
  );
  const live = new LiveRecorder(),
    e = events();
  const pending = live.start('zh', e);
  live.cancel();
  grant(t.stream);
  await pending;
  expect(t.track.stop).toHaveBeenCalledOnce();
  expect(e.onFinal).not.toHaveBeenCalled();
  expect(e.onState).toHaveBeenCalledTimes(1);
});
it('flushes tail audio before closing owned tracks and leaves borrowed tracks running', async () => {
  const t = setup(),
    capture = new SpeechCapture(),
    frames = vi.fn();
  await capture.start(frames, vi.fn());
  await capture.finish();
  expect(frames).toHaveBeenCalledWith(new Uint8Array(1600));
  expect(t.track.stop).toHaveBeenCalledOnce();
  t.track.stop.mockClear();
  await capture.start(frames, vi.fn(), t.stream);
  capture.stop();
  expect(t.track.stop).not.toHaveBeenCalled();
  expect(t.close).toHaveBeenCalledTimes(2);
  expect(t.media).toHaveBeenCalledOnce();
});
it('finish during pending permission prevents a late microphone from staying alive', async () => {
  const t = setup();
  let grant!: (s: MediaStream) => void;
  t.media.mockImplementationOnce(
    () =>
      new Promise((r) => {
        grant = r;
      }),
  );
  const live = new LiveRecorder(),
    e = events();
  const pending = live.start('zh', e);
  await live.finish();
  grant(t.stream);
  await pending;
  expect(t.track.stop).toHaveBeenCalledOnce();
  expect(e.onEnd).toHaveBeenCalledOnce();
});
it('reports capture failure and closes tracks without committing a partial sentence', async () => {
  const t = setup(),
    live = new LiveRecorder(),
    e = events();
  await live.start('zh', e);
  t.node.onprocessorerror();
  await flush();
  expect(t.track.stop).toHaveBeenCalledOnce();
  expect(e.onError).toHaveBeenCalledWith(expect.stringContaining('中断'));
  expect(e.onFinal).not.toHaveBeenCalled();
});
