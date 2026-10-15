import { afterEach, expect, it, vi } from 'vitest';
import { SpatialVoice } from '../apps/web/src/spatial-voice';
import { ClipRecorder } from '../apps/web/src/clip-recorder';
afterEach(() => vi.unstubAllGlobals());
it('never requests a microphone by default; pending permission cancellation stops late streams', async () => {
  const track = { stop: vi.fn(), addEventListener: vi.fn() },
    stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
  let resolve!: (stream: MediaStream) => void;
  const capture = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
  const link = {
    status: 'connected',
    players: [],
    self: { id: 'a' },
    chatRecording: false,
    action: vi.fn(),
  } as any;
  const voice = new SpatialVoice(link, vi.fn(), capture);
  expect(capture).not.toHaveBeenCalled();
  const starting = voice.startMic();
  voice.stopMic();
  resolve(stream);
  await starting;
  expect(track.stop).toHaveBeenCalled();
  expect(voice.state.sending).toBe(false);
  expect(voice.state.pending).toBe(false);
  link.chatRecording = true;
  await voice.startMic();
  expect(capture).toHaveBeenCalledTimes(1);
  voice.dispose();
});
it('disconnection stops active spatial microphone tracks', async () => {
  const track = { stop: vi.fn(), addEventListener: vi.fn() },
    stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
  const link = {
    status: 'connected',
    players: [],
    self: { id: 'a' },
    chatRecording: false,
    action: vi.fn(),
  } as any;
  const voice = new SpatialVoice(link, vi.fn(), async () => stream);
  await voice.startMic();
  expect(voice.state.sending).toBe(true);
  link.status = 'disconnected';
  voice.update();
  expect(track.stop).toHaveBeenCalled();
  expect(voice.state.sending).toBe(false);
  expect(voice.state.listening).toBe(false);
});
it('discarding a recording during permission request stops the late stream without publishing a draft', async () => {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
  vi.stubGlobal('MediaRecorder', class {});
  const track = { stop: vi.fn() },
    stream = { getTracks: () => [track] } as unknown as MediaStream;
  let resolve!: (s: MediaStream) => void;
  const recorder = new ClipRecorder(() => new Promise((r) => (resolve = r)));
  const done = vi.fn(),
    error = vi.fn();
  const pending = recorder.start(done, error, vi.fn());
  recorder.cancel();
  resolve(stream);
  await pending;
  expect(track.stop).toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
