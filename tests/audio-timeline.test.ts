import { expect, it } from 'vitest';
import {
  audioDuration,
  audioProgress,
} from '../apps/web/src/audio/audio-timeline';
it('replaces an estimated WebM duration with the actual duration when it becomes available', () => {
  expect(audioDuration(Infinity, 1.9)).toBe(1.9);
  expect(audioDuration(1.6237, 1.9)).toBe(1.6237);
  expect(audioDuration(Infinity, 1.9, 1.6237)).toBe(1.6237);
});
it('reaches the endpoint even when the last timeupdate precedes ended', () => {
  expect(audioProgress(1.5, 1.9, true)).toBe(1000);
  expect(audioProgress(1.6237, 1.6237, false)).toBe(1000);
});
it('maps fractional durations to an exactly reachable integer slider endpoint', () => {
  const duration = 1.6237;
  expect(audioProgress((1000 / 1000) * duration, duration, false)).toBe(1000);
  expect(audioProgress((500 / 1000) * duration, duration, false)).toBe(500);
});
it('clamps invalid times and resets the progress for replay', () => {
  expect(audioDuration(NaN, Infinity)).toBe(0);
  expect(audioProgress(NaN, 0, false)).toBe(0);
  expect(audioProgress(-1, 2, false)).toBe(0);
  expect(audioProgress(0, 1.6237, false)).toBe(0);
});
