export const WORLD_ID = 'meadow';
export type {
  ProviderType,
  ProviderView,
  AgentSettings,
  ManagedAgentView,
} from './agents';
export const PROTOCOL_VERSION = 1;
export const LIMIT = 12;
export const MAX_Y = 15;
export const REACH = 6;
export type Material = 'grass' | 'dirt' | 'stone' | 'wood';
export type Vec3 = { x: number; y: number; z: number };
export type Block = Vec3 & { material: Material };
export type Player = Vec3 & {
  id: string;
  name: string;
  kind: string;
  yaw: number;
  connected: boolean;
};
export type WorldPresence = {
  worldId: string;
  roomId: string;
  revision: number;
  capacity: number;
  persistence: string;
  updatedAt: number;
  players: Player[];
};
export type Input = { x: number; z: number; jump: boolean; yaw: number };
export type Edit = Vec3 & { material: Material | null; revision: number };
export type Snapshot = {
  blocks: Block[];
  revision: number;
  persistence: string;
};
export type WorldEvent = {
  seq: number;
  type: string;
  actor: string;
  at: number;
  data: unknown;
};
export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
export const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const inBounds = (p: Vec3) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  Math.abs(p.x) <= LIMIT &&
  Math.abs(p.z) <= LIMIT &&
  p.y >= 0 &&
  p.y <= MAX_Y;
export const height = (x: number, z: number) =>
  Math.abs(x) < 4 && Math.abs(z) < 4
    ? 2
    : 2 + Math.max(0, Math.round(Math.sin(x * 0.32) * Math.cos(z * 0.35) * 2));
export function terrain(): Map<string, Block> {
  const blocks = new Map<string, Block>();
  for (let x = -LIMIT; x <= LIMIT; x++)
    for (let z = -LIMIT; z <= LIMIT; z++)
      for (let y = 0; y <= height(x, z); y++) {
        const b: Block = {
          x,
          y,
          z,
          material: y === height(x, z) ? 'grass' : y === 0 ? 'stone' : 'dirt',
        };
        blocks.set(key(b), b);
      }
  return blocks;
}
export function overlaps(player: Vec3, b: Vec3) {
  return (
    player.x + 0.3 > b.x - 0.5 &&
    player.x - 0.3 < b.x + 0.5 &&
    player.z + 0.3 > b.z - 0.5 &&
    player.z - 0.3 < b.z + 0.5 &&
    player.y + 1.7 > b.y - 0.5 &&
    player.y < b.y + 0.5
  );
}
export function collides(p: Vec3, blocks: Map<string, Block>) {
  if (Math.abs(p.x) > LIMIT - 0.3 || Math.abs(p.z) > LIMIT - 0.3 || p.y < 0.5)
    return true;
  for (
    let x = Math.floor(p.x - 0.3 + 0.5);
    x <= Math.floor(p.x + 0.3 + 0.5);
    x++
  )
    for (
      let z = Math.floor(p.z - 0.3 + 0.5);
      z <= Math.floor(p.z + 0.3 + 0.5);
      z++
    )
      for (let y = Math.floor(p.y + 0.5); y <= Math.floor(p.y + 1.7 + 0.5); y++)
        if (blocks.has(key({ x, y, z })) && overlaps(p, { x, y, z }))
          return true;
  return false;
}
export type Body = Vec3 & { vy: number; grounded: boolean };
export function simulate(
  body: Body,
  input: Input,
  blocks: Map<string, Block>,
  dt: number,
) {
  const mag = Math.max(1, Math.hypot(input.x, input.z));
  for (const axis of ['x', 'z'] as const) {
    const next = { ...body, [axis]: body[axis] + (input[axis] / mag) * 4 * dt };
    if (!collides(next, blocks)) body[axis] = next[axis];
  }
  if (input.jump && body.grounded) {
    body.vy = 7;
    body.grounded = false;
  }
  body.vy = Math.max(-20, body.vy - 20 * dt);
  const dy = body.vy * dt,
    steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.08));
  body.grounded = false;
  for (let i = 0; i < steps; i++) {
    const next = { ...body, y: body.y + dy / steps };
    if (collides(next, blocks)) {
      body.grounded = body.vy <= 0;
      body.vy = 0;
      break;
    }
    body.y = next.y;
  }
}
export function validateEdit(
  edit: Edit,
  actor: Vec3,
  players: Vec3[],
  blocks: Map<string, Block>,
  revision: number,
): string | null {
  if (!inBounds(edit) || edit.y === 0) return 'bounds';
  if (!Number.isInteger(edit.revision) || edit.revision !== revision)
    return 'conflict';
  if (distance({ ...actor, y: actor.y + 1.3 }, edit) > REACH)
    return 'out-of-reach';
  if (
    edit.material !== null &&
    !['grass', 'dirt', 'stone', 'wood'].includes(edit.material)
  )
    return 'material';
  if (edit.material === null) return blocks.has(key(edit)) ? null : 'empty';
  if (blocks.has(key(edit))) return 'occupied';
  if (players.some((p) => overlaps(p, edit))) return 'player-occupied';
  const adjacent = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ].some(([x, y, z]) =>
    blocks.has(key({ x: edit.x + x!, y: edit.y + y!, z: edit.z + z! })),
  );
  return adjacent ? null : 'unsupported';
}
export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Input;
  if (
    ![v.x, v.z, v.yaw].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    ) ||
    Math.abs(v.x) > 1 ||
    Math.abs(v.z) > 1 ||
    Math.abs(v.yaw) > Math.PI * 4 ||
    typeof v.jump !== 'boolean'
  )
    return null;
  return { x: v.x, z: v.z, yaw: v.yaw, jump: v.jump };
}
