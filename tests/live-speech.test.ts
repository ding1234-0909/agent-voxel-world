import { describe, it, expect, vi } from 'vitest';
import {
  LiveSpeechSession,
  pcmWav,
  speechTransport,
  type SpeechTransport,
} from '../apps/web/src/audio/live-speech';
import { validatePcmWav } from '../apps/server/src/audio/local-speech';
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function frame(loud = true) {
  const bytes = new Uint8Array(3200),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length; i += 2)
    view.setInt16(i, loud ? 2000 : 0, true);
  return bytes;
}
function setup() {
  let id = 0;
  const transport = {
    begin: vi.fn(async () => String(++id)),
    recognize: vi.fn(
      async (
        _id: string,
        _audio: Blob,
        partial: boolean,
        _signal: AbortSignal,
      ): Promise<string> => (partial ? '临时' : '确认'),
    ),
    release: vi.fn(),
  } satisfies SpeechTransport;
  const events = {
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
  };
  const session = new LiveSpeechSession(transport, events);
  const feed = (count: number, loud = true) => {
    for (let i = 0; i < count; i++) session.feed(frame(loud));
  };
  return { transport, events, session, feed };
}
describe('live speech confirmation boundary', () => {
  it('emits revisable previews while speaking and confirms once after silence', async () => {
    const t = setup();
    t.feed(12);
    await flush();
    expect(t.events.onPartial).toHaveBeenLastCalledWith('临时');
    expect(t.events.onFinal).not.toHaveBeenCalled();
    t.transport.recognize.mockResolvedValueOnce('修正后的临时字幕');
    t.feed(12);
    await flush();
    expect(t.events.onPartial).toHaveBeenLastCalledWith('修正后的临时字幕');
    t.feed(9, false);
    await flush();
    expect(t.events.onFinal).toHaveBeenCalledExactlyOnceWith('确认');
    t.feed(30, false);
    await flush();
    expect(t.events.onFinal).toHaveBeenCalledOnce();
    t.session.finish();
    expect(t.events.onEnd).toHaveBeenCalledOnce();
  });
  it('ignores late previews once an utterance has ended, then recomputes final text', async () => {
    const t = setup();
    let resolve!: (text: string) => void;
    t.transport.recognize.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    t.feed(12);
    await flush();
    t.feed(9, false);
    resolve('过时的预览');
    await flush();
    expect(t.events.onPartial).not.toHaveBeenCalledWith('过时的预览');
    expect(t.events.onFinal).toHaveBeenCalledExactlyOnceWith('确认');
    expect(t.transport.recognize.mock.calls.map((c) => c[2])).toEqual([
      true,
      false,
    ]);
    t.session.cancel();
  });
  it('flushes the final short sentence on finish and never promotes the preview', async () => {
    const t = setup();
    t.feed(6);
    t.session.finish();
    await flush();
    expect(t.transport.recognize.mock.calls.map((c) => c[2])).toEqual([false]);
    expect(t.events.onEnd).toHaveBeenCalledOnce();
    t.session.finish();
    expect(t.events.onFinal).toHaveBeenCalledOnce();
  });
  it('cancels pending recognition and ignores late results without final delivery', async () => {
    const t = setup();
    let resolve!: (text: string) => void;
    t.transport.recognize.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    t.feed(12);
    await flush();
    t.session.cancel();
    expect(t.transport.recognize.mock.calls[0][3].aborted).toBe(true);
    resolve('late');
    await flush();
    expect(t.events.onFinal).not.toHaveBeenCalled();
    expect(t.events.onPartial).not.toHaveBeenCalledWith('late');
    expect(t.transport.release).toHaveBeenCalledWith('1');
  });
  it('retains sentence order and does not replay failed final requests', async () => {
    const t = setup();
    let resolve!: (text: string) => void;
    let finalCalls = 0;
    t.transport.recognize.mockImplementation(async (_id, _audio, partial) => {
      if (partial) return 'preview';
      if (++finalCalls === 1)
        return new Promise<string>((r) => {
          resolve = r;
        });
      throw Error('final failed');
    });
    t.feed(6);
    t.feed(9, false);
    await flush();
    t.feed(6);
    t.feed(9, false);
    await flush();
    expect(finalCalls).toBe(1);
    resolve('first');
    await flush();
    expect(t.events.onFinal).toHaveBeenCalledExactlyOnceWith('first');
    expect(t.events.onError).toHaveBeenCalledWith('final failed');
    expect(finalCalls).toBe(2);
  });
  it('bounds queued work and reports overload without emitting unconfirmed text', async () => {
    const t = setup();
    t.transport.recognize.mockImplementation(() => new Promise(() => {}));
    t.feed(6);
    t.feed(9, false);
    await flush();
    t.feed(6);
    t.feed(9, false);
    t.feed(1);
    expect(t.events.onError).toHaveBeenCalledWith(
      expect.stringContaining('跟不上'),
    );
    expect(t.events.onFinal).not.toHaveBeenCalled();
  });
  it('does not infer on silence and caps long utterances at twelve seconds', async () => {
    const t = setup();
    t.feed(40, false);
    await flush();
    expect(t.transport.begin).not.toHaveBeenCalled();
    t.feed(120);
    await flush();
    expect(t.events.onFinal).toHaveBeenCalledOnce();
    t.session.cancel();
  });
  it('releases a ticket granted after cancellation', async () => {
    const t = setup();
    let resolve!: (id: string) => void;
    t.transport.begin.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    t.feed(1);
    t.session.cancel();
    resolve('late-ticket');
    await flush();
    expect(t.transport.release).toHaveBeenCalledWith('late-ticket');
    expect(t.transport.recognize).not.toHaveBeenCalled();
  });
  it('encodes every growing snapshot as valid standalone PCM WAV', async () => {
    const blob = pcmWav([frame(), frame(), frame(), frame()]);
    expect(validatePcmWav(Buffer.from(await blob.arrayBuffer()))).toBe(400);
  });
  it('separates authenticated spatial previews from final publication', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ id: 'ticket', text: 'hello' })),
    );
    const transport = speechTransport(
      'zh',
      () => 'private-token',
      request as typeof fetch,
    );
    const signal = new AbortController().signal;
    const id = await transport.begin(signal);
    await transport.recognize(id, pcmWav([frame()]), true, signal);
    await transport.recognize(id, pcmWav([frame()]), false, signal);
    expect((request.mock.calls as unknown[][]).map((call) => call[0])).toEqual([
      expect.stringContaining('/chat/spatial/start'),
      expect.stringContaining('/chat/spatial/ticket/preview'),
      expect.stringMatching(/\/chat\/spatial\/ticket$/),
    ]);
    expect(
      (request.mock.calls as unknown as [string, RequestInit][])[1][1].headers,
    ).toMatchObject({ Authorization: 'Bearer private-token' });
  });
});
