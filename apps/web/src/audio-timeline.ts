/** WebM duration may start as Infinity and become available during playback. */
export function audioDuration(
  metadata: number,
  fallback: number,
  endedAt?: number,
) {
  for (const value of [metadata, endedAt, fallback]) {
    if (value !== undefined && Number.isFinite(value) && value > 0)
      return value;
  }
  return 0;
}

/** A fixed integer range makes the right endpoint reachable for any duration. */
export function audioProgress(
  current: number,
  duration: number,
  ended: boolean,
) {
  if (ended) return 1000;
  if (!duration || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(1000, Math.round((current / duration) * 1000)));
}
