import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseChatRoute,
  spatialMix,
  visibleEvent,
  type Player,
  type WorldEvent,
} from '../packages/shared/src/index';
import { WorldChat } from '../apps/server/src/chat';
import { agentChatContext, executeAction } from '../apps/agent/src/deepseek';
import type { Observation } from '../apps/agent/src/session';
const player = (id: string): Player => ({
  id,
  name: id,
  kind: 'human',
  connected: true,
  x: 0,
  y: 2,
  z: 0,
  yaw: 0,
});
const event = (actor: string, scope: string, recipients: string[] = []) => ({
  seq: 1,
  type: 'chat',
  actor,
  data: { name: actor, text: 'secret', scope, recipients, kind: 'text' },
  at: 0,
});
afterEach(() => vi.restoreAllMocks());
describe('private chat', () => {
  it('rejects empty, duplicate and malformed private recipients', () => {
    expect(parseChatRoute({ text: 'hi' })).toEqual({
      scope: 'public',
      recipients: [],
    });
    for (const recipients of [
      [],
      ['x', 'x'],
      ['../x'],
      Array(9).fill('x'),
      [2],
    ])
      expect(() => parseChatRoute({ scope: 'private', recipients })).toThrow();
  });
  it('restricts live/history visibility to sender and recipients including agents', () => {
    const e = event('a', 'private', ['b', 'ai']);
    for (const id of ['a', 'b', 'ai']) expect(visibleEvent(e, id)).toBe(true);
    expect(visibleEvent(e, 'outsider')).toBe(false);
    expect(visibleEvent(event('a', 'public'), 'outsider')).toBe(true);
  });
  it('validates recipients, rotates session credentials and enforces audio ACL/expiry', () => {
    const people = [player('a'), player('b'), player('outsider')],
      emit = vi.fn(),
      chat = new WorldChat(() => people, emit);
    const old = chat.issue('a'),
      token = chat.issue('a');
    expect(() => chat.authenticate(old)).toThrow();
    expect(chat.authenticate(token)).toBe('a');
    expect(() =>
      chat.send('a', {
        text: 'secret',
        scope: 'private',
        recipients: ['missing'],
      }),
    ).toThrow();
    expect(emit).not.toHaveBeenCalled();
    chat.send('a', { text: 'secret', scope: 'private', recipients: ['b'] });
    expect(emit.mock.calls[0][1].scope).toBe('private');
    chat.beginUpload('a', {});
    expect(() => chat.beginUpload('a', {})).toThrow();
    chat.endUpload('a');
    const audio = chat.publishAudio(
      'a',
      { scope: 'private', recipients: ['b'] },
      Buffer.from('audio'),
      1000,
      'hello',
    );
    expect(chat.audio(audio.audioId!, 'b').toString()).toBe('audio');
    expect(() => chat.audio(audio.audioId!, 'outsider')).toThrow();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 600001);
    expect(() => chat.audio(audio.audioId!, 'a')).toThrow();
    people[0].connected = false;
    expect(() => chat.authenticate(token)).toThrow();
    chat.clear();
  });
  it('does not carry private context into public turns and forces replies private', async () => {
    const observation: Observation = {
      id: 'x',
      revision: 0,
      self: player('ai'),
      players: [],
      blocks: [],
      events: [event('a', 'private', ['ai'])],
      radius: 8,
      allowedActions: [],
    };
    const request = vi.fn().mockResolvedValue({ ok: true });
    await executeAction(
      { request, move: vi.fn() },
      { type: 'chat', text: 'reply', scope: 'public', recipients: [] },
      observation,
      false,
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith('chat', {
      text: 'reply',
      scope: 'private',
      recipients: ['a'],
    });
    observation.events.push(event('b', 'public'));
    expect(agentChatContext(observation).events).toHaveLength(1);
    observation.events.push(event('b', 'private', ['ai']));
    expect(
      agentChatContext(observation).events.some((e) => e.actor === 'a'),
    ).toBe(false);
  });
});
describe('spatial sound', () => {
  it('attenuates by distance and speaker facing, mutes beyond 18 blocks', () => {
    const speaker = player('a'),
      near = { ...player('b'), z: -1 },
      far = { ...near, z: -10 };
    expect(spatialMix(near, speaker).gain).toBe(1);
    expect(spatialMix(far, speaker).gain).toBeLessThan(1);
    expect(spatialMix({ ...near, z: -18 }, speaker).gain).toBe(0);
    expect(spatialMix(near, { ...speaker, yaw: Math.PI }).gain).toBeCloseTo(
      0.35,
    );
  });
  it('rotates stereo placement with the listener', () => {
    const listener = player('a'),
      speaker = { ...player('b'), x: 2 };
    expect(spatialMix(listener, speaker).pan).toBe(1);
    expect(spatialMix({ ...listener, yaw: Math.PI }, speaker).pan).toBe(-1);
    expect(spatialMix(listener, listener).pan).toBe(0);
  });
});

describe('nearby speech delivery', () => {
  const setup = () => {
    const speaker = { ...player('s'), voiceSending: true },
      near = { ...player('ai'), kind: 'ai-agent' as const, z: -2 },
      far = { ...player('far'), kind: 'ai-agent' as const, z: -20 },
      human = { ...player('h'), z: -2, voiceListening: false };
    const people = [speaker, near, far, human],
      emit = vi.fn(),
      chat = new WorldChat(() => people, emit);
    return { speaker, near, far, human, people, chat, emit };
  };
  it('captures audible listeners at segment start and never broadcasts transcripts', () => {
    const { chat, emit, human, far } = setup();
    const id = chat.beginSpatial('s');
    chat.claimSpatial('s', id);
    human.voiceListening = true;
    far.z = -1; // Joined hearing range after capture began.
    const data = chat.publishSpatial('s', id, '附近说的话');
    expect(data.recipients).toEqual(['ai']);
    expect(data.scope).toBe('nearby');
    const e = { ...event('s', 'nearby'), data };
    expect(visibleEvent(e, 'ai')).toBe(true);
    expect(visibleEvent(e, 'far')).toBe(false);
    expect(visibleEvent(e, 's')).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(() => chat.claimSpatial('s', id)).toThrow();
  });
  it('uses facing as well as distance and removes departed listeners before delivery', () => {
    const { chat, near, speaker } = setup();
    near.z = -14;
    const front = chat.beginSpatial('s');
    chat.claimSpatial('s', front);
    expect(chat.publishSpatial('s', front, 'front').recipients).toEqual(['ai']);
    speaker.yaw = Math.PI;
    const back = chat.beginSpatial('s');
    chat.claimSpatial('s', back);
    expect(chat.publishSpatial('s', back, 'back').recipients).toEqual([]);
    near.z = -2;
    const left = chat.beginSpatial('s');
    chat.claimSpatial('s', left);
    near.z = -30;
    expect(chat.publishSpatial('s', left, 'left').recipients).toEqual([]);
  });
  it('cancels inference on mute and invalidates old chunks even after reopening mic', () => {
    const { chat, speaker, emit } = setup();
    const id = chat.beginSpatial('s'),
      signal = chat.claimSpatial('s', id);
    speaker.voiceSending = false;
    chat.cancelSpatial('s');
    expect(signal.aborted).toBe(true);
    speaker.voiceSending = true;
    expect(() => chat.publishSpatial('s', id, 'late')).toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
  it('requires an active human mic, rejects forged/replayed tickets and bounds pending work', () => {
    const { chat, speaker } = setup();
    speaker.voiceSending = false;
    expect(() => chat.beginSpatial('s')).toThrow();
    expect(() => chat.beginSpatial('ai')).toThrow();
    speaker.voiceSending = true;
    const id = chat.beginSpatial('s');
    expect(() => chat.claimSpatial('ai', id)).toThrow();
    chat.claimSpatial('s', id);
    expect(() => chat.claimSpatial('s', id)).toThrow();
    for (let i = 0; i < 3; i++) chat.beginSpatial('s');
    expect(() => chat.beginSpatial('s')).toThrow();
    chat.clear();
  });
  it('keeps nearby replies scoped and excludes nearby history from public model turns', async () => {
    const observation: Observation = {
      id: 'x',
      revision: 0,
      self: player('ai'),
      players: [],
      blocks: [],
      events: [event('s', 'nearby', ['ai'])],
      radius: 8,
      allowedActions: [],
    };
    const request = vi.fn().mockResolvedValue({ ok: true });
    await executeAction(
      { request, move: vi.fn() },
      { type: 'chat', text: '我听到了' },
      observation,
      false,
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith('chat', {
      text: '我听到了',
      scope: 'private',
      recipients: ['s'],
    });
    observation.events.push(event('b', 'public'));
    expect(agentChatContext(observation).events).toHaveLength(1);
  });
});
