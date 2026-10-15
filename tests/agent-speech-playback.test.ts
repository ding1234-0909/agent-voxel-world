import { expect, it, vi } from 'vitest';
import { AgentSpeechPlayback } from '../apps/web/src/agent-speech-playback';
import type { AgentSpeechEvent } from '../packages/shared/src';
const event = (id = 'clip'): AgentSpeechEvent => ({
  id,
  actor: 'ai',
  text: '你好',
  scope: 'public',
  durationMs: 1000,
  expiresAt: Date.now() + 60000,
});
function setup() {
  const speaker = {
    id: 'ai',
    kind: 'ai-agent',
    name: 'AI',
    connected: true,
    voiceReplies: true,
    x: 0,
    y: 2,
    z: 0,
    yaw: 0,
  };
  const self = { id: 'me', x: 0, y: 2, z: -1, yaw: 0 };
  const link = {
    status: 'connected',
    players: [speaker],
    self,
    chatToken: 'private-token',
  } as any;
  let listening = true;
  const gains: any[] = [],
    pans: any[] = [],
    sources: any[] = [];
  const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
  const node = () => ({
    connect: vi.fn(function (this: any) {
      return this;
    }),
    disconnect: vi.fn(),
  });
  const context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    decodeAudioData: vi.fn(async () => ({})),
    createBufferSource: () => {
      const source = {
        ...node(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    },
    createGain: () => {
      const gain = { ...node(), gain: param() };
      gains.push(gain);
      return gain;
    },
    createStereoPanner: () => {
      const pan = { ...node(), pan: param() };
      pans.push(pan);
      return pan;
    },
  } as any;
  const fetchAudio = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) }) as Response,
  );
  const changed = vi.fn();
  const player = new AgentSpeechPlayback(
    link,
    () => context,
    () => listening,
    changed,
    fetchAudio,
  );
  return {
    player,
    speaker,
    self,
    link,
    context,
    fetchAudio,
    changed,
    gains,
    pans,
    sources,
    mute() {
      listening = false;
      player.update();
    },
  };
}
it('loads with auth, starts once, and updates volume/pan as players move and turn', async () => {
  const s = setup();
  s.player.receive(event());
  s.player.receive(event());
  await vi.waitFor(() => expect(s.sources[0]?.start).toHaveBeenCalledTimes(1));
  expect(s.fetchAudio).toHaveBeenCalledTimes(1);
  expect(s.fetchAudio.mock.calls[0][1]?.headers).toEqual({
    Authorization: 'Bearer private-token',
  });
  expect(s.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.04);
  s.speaker.yaw = Math.PI;
  s.player.update();
  expect(s.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0.35,
    0,
    0.04,
  );
  s.self.x = 4;
  s.player.update();
  expect(s.pans[0].pan.setTargetAtTime.mock.lastCall[0]).toBeLessThan(0);
  s.self.z = 30;
  s.player.update();
  expect(s.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.04);
  s.mute();
  expect(s.sources[0].stop).toHaveBeenCalled();
  expect(s.sources[0].disconnect).toHaveBeenCalled();
});
it('drops queued clips on mute and stops when the speaker disables voice or disconnects', async () => {
  const s = setup();
  s.player.receive(event());
  s.player.receive(event('queued'));
  await vi.waitFor(() => expect(s.sources.length).toBe(1));
  s.speaker.voiceReplies = false;
  s.player.update();
  expect(s.sources[0].stop).toHaveBeenCalled();
  expect(s.fetchAudio).toHaveBeenCalledTimes(1);
  s.mute();
  s.player.receive(event('muted'));
  expect(s.fetchAudio).toHaveBeenCalledTimes(1);
});
it('a late decode after muting cannot start audio, and historical/expired events are ignored', async () => {
  const s = setup();
  let resolve!: (buffer: unknown) => void;
  s.context.decodeAudioData.mockImplementation(
    () => new Promise((r) => (resolve = r)),
  );
  s.player.receive({ ...event(), expiresAt: Date.now() - 1 });
  expect(s.fetchAudio).not.toHaveBeenCalled();
  s.player.receive(event());
  await vi.waitFor(() => expect(s.context.decodeAudioData).toHaveBeenCalled());
  s.mute();
  resolve({});
  await new Promise((r) => setTimeout(r, 0));
  expect(s.sources).toHaveLength(0);
});
it('cleans up a failed source start and can play the next reply', async () => {
  const s = setup();
  const create = s.context.createBufferSource;
  s.context.createBufferSource = () => {
    const source = create();
    source.start.mockImplementationOnce(() => {
      throw Error('start failed');
    });
    s.context.createBufferSource = create;
    return source;
  };
  s.player.receive(event());
  await vi.waitFor(() =>
    expect(s.changed).toHaveBeenCalledWith('', 'start failed'),
  );
  s.player.receive(event('next'));
  await vi.waitFor(() => expect(s.sources[1]?.start).toHaveBeenCalled());
  s.player.stop();
});
