import type { Player, WorldEvent } from './index';
export type ChatRoute = { scope: 'public' | 'private'; recipients: string[] };
export type ChatData = Omit<ChatRoute, 'scope'> & {
  scope: 'public' | 'private' | 'nearby';
  name: string;
  text: string;
  kind: 'text' | 'audio';
  audioId?: string;
  durationMs?: number;
  transcriptAvailable?: boolean;
};
export type ChatEntry = WorldEvent & { data: ChatData };
export type AgentSpeechEvent = {
  id: string;
  actor: string;
  text: string;
  scope: 'public' | 'private';
  durationMs: number;
  expiresAt: number;
};
export function parseChatRoute(value: unknown): ChatRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('无效消息。');
  const p = value as Record<string, unknown>;
  const scope = p.scope === undefined ? 'public' : p.scope;
  const recipients = p.recipients === undefined ? [] : p.recipients;
  if (
    (scope !== 'public' && scope !== 'private') ||
    !Array.isArray(recipients) ||
    recipients.length > 8 ||
    recipients.some(
      (id) => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id),
    ) ||
    new Set(recipients).size !== recipients.length
  )
    throw Error('接收对象无效，最多选择 8 位。');
  if (scope === 'private' && !recipients.length)
    throw Error('私聊请先通过 @ 选择接收对象。');
  return { scope, recipients: recipients as string[] };
}
export function visibleEvent(event: WorldEvent, playerId: string) {
  if (event.type !== 'chat') return true;
  const d = event.data as ChatData;
  return (
    (d.scope !== 'private' && d.scope !== 'nearby') ||
    event.actor === playerId ||
    d.recipients.includes(playerId)
  );
}
export const SPATIAL_RANGE = 18;
/** World forward is (-sin(yaw), 0, -cos(yaw)); front speech carries further. */
export function spatialMix(
  listener: Pick<Player, 'x' | 'y' | 'z' | 'yaw'>,
  speaker: Pick<Player, 'x' | 'y' | 'z' | 'yaw'>,
) {
  const dx = listener.x - speaker.x,
    dy = listener.y - speaker.y,
    dz = listener.z - speaker.z;
  const d = Math.hypot(dx, dy, dz),
    horizontal = Math.hypot(dx, dz);
  const facing =
    horizontal < 0.001
      ? 1
      : (-Math.sin(speaker.yaw) * dx - Math.cos(speaker.yaw) * dz) / horizontal;
  const gain =
    d >= SPATIAL_RANGE
      ? 0
      : (1 - Math.max(0, d - 1) / (SPATIAL_RANGE - 1)) ** 2 *
        (0.35 + (0.65 * (facing + 1)) / 2);
  const pan =
    horizontal < 0.001
      ? 0
      : (-dx * Math.cos(listener.yaw) + dz * Math.sin(listener.yaw)) /
        horizontal;
  return { gain, pan: Math.max(-1, Math.min(1, pan)) };
}

/** Minimum intelligible speech gain; shared with server-side caption routing. */
export const SPEECH_HEARING_THRESHOLD = 0.03;
