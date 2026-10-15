import { expect, it, vi } from 'vitest';
import { AgentSpeech } from '../apps/server/src/agent-speech';
import type {
  AgentSpeechEvent,
  ChatData,
  Player,
} from '../packages/shared/src';
const person = (id: string, kind = 'human'): Player => ({
  id,
  name: id,
  kind,
  x: 0,
  y: 2,
  z: -2,
  yaw: 0,
  connected: true,
  voiceListening: true,
  voiceReplies: true,
});
const message = (scope: 'public' | 'private' = 'public'): ChatData => ({
  kind: 'text',
  scope,
  recipients: scope === 'private' ? ['a'] : [],
  name: 'Agent',
  text: '你好',
});
function setup() {
  const players = [
    { ...person('ai', 'ai-agent'), z: 0 },
    person('a'),
    person('b'),
    { ...person('far'), z: 30 },
    { ...person('muted'), voiceListening: false },
  ];
  const synthesize = vi.fn(
    async (
      _text: string,
      _signal: AbortSignal,
    ): Promise<{ bytes: Buffer; durationMs: number }> => ({
      bytes: Buffer.from('wav'),
      durationMs: 1000,
    }),
  );
  const notify = vi.fn<(id: string, event: AgentSpeechEvent) => void>(),
    report = vi.fn();
  const service = new AgentSpeech(() => players, notify, report, {
    synthesize,
  });
  return { players, synthesize, notify, report, service };
}
it('synthesizes once and only delivers to nearby opted-in humans', async () => {
  const { service, notify, synthesize } = setup();
  service.enqueue('ai', message());
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  expect(synthesize).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  const event = notify.mock.calls[0][1];
  expect(service.audio(event.id, 'a').toString()).toBe('wav');
  for (const id of ['ai', 'far', 'muted'])
    expect(() => service.audio(event.id, id)).toThrow();
  service.close();
});
it('private speech never notifies or authorizes another nearby player', async () => {
  const { service, notify, players } = setup();
  service.enqueue('ai', message('private'));
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  const event = notify.mock.calls[0][1];
  expect(event.scope).toBe('private');
  expect(() => service.audio(event.id, 'b')).toThrow();
  players[1].voiceListening = false;
  expect(() => service.audio(event.id, 'a')).toThrow();
  players[1].voiceListening = true;
  players[1].z = 30;
  expect(() => service.audio(event.id, 'a')).toThrow();
  service.close();
});
it('does not synthesize when disabled or nobody is listening', () => {
  const { service, players, synthesize } = setup();
  players[0].voiceReplies = false;
  service.enqueue('ai', message());
  players[0].voiceReplies = true;
  players.forEach((p) => (p.voiceListening = false));
  service.enqueue('ai', message());
  expect(synthesize).not.toHaveBeenCalled();
  service.close();
});
it('cancels in-flight synthesis, queued replies, and cached clips on disable/leave', async () => {
  const { service, synthesize, notify } = setup();
  let resolve!: (v: { bytes: Buffer; durationMs: number }) => void;
  synthesize.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  service.enqueue('ai', message());
  service.enqueue('ai', message());
  const signal = synthesize.mock.calls[0][1] as AbortSignal;
  service.cancel('ai');
  expect(signal.aborted).toBe(true);
  resolve({ bytes: Buffer.from('wav'), durationMs: 1000 });
  await new Promise((r) => setTimeout(r, 0));
  expect(notify).not.toHaveBeenCalled();
  expect(synthesize).toHaveBeenCalledTimes(1);
  service.enqueue('ai', message());
  await vi.waitFor(() => expect(notify).toHaveBeenCalled());
  const id = notify.mock.calls[0][1].id;
  service.cancel('ai');
  expect(() => service.audio(id, 'a')).toThrow();
  service.close();
});
it('uses the intersection of listeners before and after synthesis and reports failures', async () => {
  const { service, synthesize, notify, players, report } = setup();
  let resolve!: (v: { bytes: Buffer; durationMs: number }) => void;
  synthesize.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  service.enqueue('ai', message());
  players[1].voiceListening = false;
  players[3].z = -2;
  resolve({ bytes: Buffer.from('wav'), durationMs: 1000 });
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify.mock.calls[0][0]).toBe('b');
  synthesize.mockRejectedValueOnce(Error('failed'));
  service.enqueue('ai', message());
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith('ai', 'failed'));
  service.close();
});
