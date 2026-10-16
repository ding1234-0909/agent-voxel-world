import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  PCMPlayer,
  PCMCapture,
  pcmFloats,
} from '../apps/web/src/audio/realtime-audio';
describe('realtime browser audio', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('stops a stream granted after cancellation without creating audio processing', async () => {
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => (grant = resolve)),
      },
    });
    const capture = new PCMCapture(),
      send = vi.fn();
    const pending = capture.start(send, vi.fn());
    capture.stop();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    expect(await pending).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
  it('propagates microphone permission denial without sending audio', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(Error('denied')),
      },
    });
    const send = vi.fn();
    await expect(new PCMCapture().start(send, vi.fn())).rejects.toThrow(
      'denied',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('decodes signed little-endian PCM and rejects malformed chunks', () => {
    expect([
      ...pcmFloats(Buffer.from([0, 128, 0, 0, 255, 127]).toString('base64')),
    ]).toEqual([-1, 0, 32767 / 32768]);
    expect(() => pcmFloats('AA==')).toThrow();
    expect(() => pcmFloats('!')).toThrow();
  });
  it('schedules at 24kHz, stops all sources, and rejects stalled playback', () => {
    const sources: any[] = [];
    const context: any = {
      state: 'running',
      currentTime: 2,
      destination: {},
      createBuffer: vi.fn((_: number, n: number, rate: number) => ({
        duration: n / rate,
        copyToChannel: vi.fn(),
      })),
      createBufferSource: () => {
        const s = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        };
        sources.push(s);
        return s;
      },
    };
    const player = new PCMPlayer(context);
    player.play(Buffer.alloc(4800).toString('base64'));
    player.play(Buffer.alloc(4800).toString('base64'));
    expect(context.createBuffer.mock.calls[0][2]).toBe(24000);
    expect(sources[1].start).toHaveBeenCalledWith(2.1);
    player.stop();
    expect(sources.every((s) => s.stop.mock.calls.length === 1)).toBe(true);
    context.state = 'suspended';
    expect(() => player.play('AAA=')).toThrow('suspended');
  });
  it.each([44100, 48000])(
    'worklet resamples %iHz across render boundaries to 16kHz PCM',
    (rate) => {
      const chunks: ArrayBuffer[] = [];
      let Constructor: any;
      runInNewContext(
        readFileSync(
          new URL('../apps/web/src/audio/pcm-worklet.js', import.meta.url),
          'utf8',
        ),
        {
          sampleRate: rate,
          AudioWorkletProcessor: class {
            port = { postMessage: (chunk: ArrayBuffer) => chunks.push(chunk) };
          },
          registerProcessor: (_: string, c: any) => (Constructor = c),
        },
      );
      const processor = new Constructor();
      for (let offset = 0; offset < rate; offset += 128)
        processor.process([
          [new Float32Array(Math.min(128, rate - offset)).fill(0.5)],
        ]);
      expect(chunks).toHaveLength(10);
      expect(
        chunks.every(
          (c) =>
            c.byteLength === 3200 &&
            new DataView(c).getInt16(0, true) === 16384,
        ),
      ).toBe(true);
    },
  );
});
