import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { BailianSession, decodePCM } from '../apps/server/src/bailian';
import { DemoSocket } from '../apps/server/src/bailian-demo';
import type { RealtimeEvent } from '../packages/shared/src/realtime';
class Socket extends EventEmitter {
  bufferedAmount = 0;
  sent: any[] = [];
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close = vi.fn();
  receive(event: any) {
    this.emit('message', JSON.stringify(event));
  }
}
const sessions: BailianSession[] = [];
function setup(scene = true) {
  const socket = new Socket();
  const events: RealtimeEvent[] = [];
  const observe = vi.fn(() => ({ revision: 3, blocks: [] }));
  const session = new BailianSession(
    true,
    scene ? { observe, revision: () => 3 } : undefined,
    (e) => events.push(e),
  );
  sessions.push(session);
  session.start(
    {
      enabled: false,
      workspace: 'offline',
      credential: () => {
        throw Error('must not read');
      },
    },
    () => socket,
  );
  socket.emit('open');
  socket.receive({ type: 'session.updated' });
  return { session, socket, events, observe };
}
afterEach(() => {
  sessions.splice(0).forEach((s) => s.close());
  vi.useRealTimers();
});
describe('Bailian offline protocol', () => {
  it('blocks real mode before credential lookup or dialing', () => {
    const credential = vi.fn(),
      dial = vi.fn();
    const s = new BailianSession(false, undefined, () => {});
    expect(() =>
      s.start({ enabled: false, workspace: '', credential }, dial),
    ).toThrow('disabled');
    expect(credential).not.toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
  });
  it('uses manual PCM sessions and exposes only consented tools', () => {
    const { socket } = setup(false);
    expect(socket.sent[0].session).toMatchObject({
      turn_detection: null,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      tools: [],
    });
    expect(
      setup().socket.sent[0].session.tools.map((t: any) => t.function.name),
    ).toEqual(['observe_scene', 'propose_block_edit']);
  });
  it('validates audio, byte duration and turn order', () => {
    const { session, socket } = setup();
    expect(() => session.audio('??')).toThrow('invalid-pcm');
    expect(() => decodePCM('AA==', 8)).toThrow();
    for (let i = 0; i < 75; i++)
      session.audio(Buffer.alloc(6400).toString('base64'));
    expect(() => session.audio('AAA=')).toThrow('input-time-limit');
    session.commit();
    expect(socket.sent.slice(-2).map((e) => e.type)).toEqual([
      'input_audio_buffer.commit',
      'response.create',
    ]);
    expect(() => session.commit('overlap')).toThrow('not-listening');
  });
  it('waits for response.done before continuing after a tool, ignores duplicate calls', () => {
    const { session, socket, observe } = setup();
    session.commit('看看周围');
    socket.receive({ type: 'response.created', response: { id: 'r1' } });
    const e = {
      type: 'response.function_call_arguments.done',
      response_id: 'r1',
      call_id: 'c1',
      name: 'observe_scene',
      arguments: '{}',
    };
    socket.receive(e);
    socket.receive(e);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(
      socket.sent.filter((e) => e.type === 'response.create'),
    ).toHaveLength(1);
    socket.receive({ type: 'response.done', response: { id: 'r1' } });
    expect(
      socket.sent.filter((e) => e.type === 'response.create'),
    ).toHaveLength(2);
  });
  it('makes proposals one-use, session-scoped, and expiring without editing', () => {
    vi.useFakeTimers();
    const { session, socket, events } = setup();
    session.commit('建造');
    socket.receive({ type: 'response.created', response: { id: 'r' } });
    const propose = (id: string) =>
      socket.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'r',
        call_id: id,
        name: 'propose_block_edit',
        arguments: JSON.stringify({ x: 2, y: 3, z: 2, material: 'wood' }),
      });
    propose('a');
    const id = events.find((e) => e.kind === 'proposal')!.proposal!.id;
    expect(() => setup().session.takeProposal(id)).toThrow();
    expect(session.takeProposal(id)).toEqual({
      x: 2,
      y: 3,
      z: 2,
      material: 'wood',
      revision: 3,
    });
    expect(() => session.takeProposal(id)).toThrow();
    propose('b');
    vi.advanceTimersByTime(30001);
    expect(() => session.takeProposal(events.at(-1)!.proposal!.id)).toThrow();
  });
  it('rejects unknown tools and unconsented scene data', () => {
    const { session, socket, observe } = setup(false);
    session.commit('hello');
    socket.receive({ type: 'response.created', response: { id: 'r' } });
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'c',
      name: 'observe_scene',
      arguments: '{}',
    });
    expect(observe).not.toHaveBeenCalled();
    expect(socket.sent.at(-1).item.output).toContain('tool-not-allowed');
  });
  it('closes on interruption, suppresses late audio, never reflects upstream secrets', () => {
    const { session, socket, events } = setup();
    session.commit('hello');
    socket.receive({ type: 'response.created', response: { id: 'r' } });
    session.close();
    const count = events.length;
    socket.receive({ type: 'response.audio.delta', delta: 'AAA=' });
    expect(events).toHaveLength(count);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.sent.at(-1).type).toBe('response.cancel');
    const other = setup();
    other.socket.receive({
      type: 'error',
      error: { message: 'private upstream detail' },
    });
    expect(JSON.stringify(other.events)).not.toContain(
      'private upstream detail',
    );
  });
  it('handles backpressure without recursive close and caps session time', () => {
    vi.useFakeTimers();
    const a = setup();
    a.socket.bufferedAmount = 200000;
    a.session.commit('hello');
    expect(a.events.some((e) => e.text === 'provider-backpressure')).toBe(true);
    const b = setup();
    vi.advanceTimersByTime(120000);
    expect(b.events.some((e) => e.text === 'session-time-limit')).toBe(true);
  });
  it('plays deterministic demo protocol without credentials or network', async () => {
    const events: RealtimeEvent[] = [];
    const s = new BailianSession(true, undefined, (e) => events.push(e));
    sessions.push(s);
    s.start(
      {
        enabled: false,
        workspace: 'offline',
        credential: () => {
          throw Error();
        },
      },
      () => new DemoSocket(),
    );
    await new Promise((resolve) => setImmediate(resolve));
    s.commit('demo');
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.some((e) => e.kind === 'audio')).toBe(true);
    expect(events.at(-1)?.kind).toBe('done');
    expect(events.every((e) => e.demo)).toBe(true);
  });
});
