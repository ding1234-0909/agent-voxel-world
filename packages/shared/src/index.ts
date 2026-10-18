export * from './chat';
export * from './voice-services';
export const WORLD_ID = 'meadow';
export type {
  ProviderType,
  ProviderView,
  AgentSettings,
  AgentTask,
  AgentTaskStatus,
  AgentUsage,
  ManagedAgentView,
} from './agents';
export const PROTOCOL_VERSION = 1;
export const LIMIT = 24;
export const MAX_Y = 15;
export const REACH = 6;
export type Material =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'cobble'
  | 'sand'
  | 'planks'
  | 'leaves'
  | 'brick'
  | 'workbench'
  | 'water';
/** All server-valid placeable materials (single source of truth). */
export const MATERIALS: Material[] = [
  'grass',
  'dirt',
  'stone',
  'wood',
  'cobble',
  'sand',
  'planks',
  'leaves',
  'brick',
  'workbench',
];
export type Vec3 = { x: number; y: number; z: number };
export type Block = Vec3 & { material: Material };
export type Player = Vec3 & {
  id: string;
  name: string;
  kind: string;
  yaw: number;
  connected: boolean;
  voiceSending?: boolean;
  voiceListening?: boolean;
  voiceReplies?: boolean;
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
  actorKind?: string;
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
/** Deterministic 2D value noise (bilinear-interpolated hashes), 0..1. */
function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const h = (a: number, b: number) => {
    let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + 20261008) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  };
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Terrain height: a flat safe-spawn plateau in the middle, gentle Minecraft-like
 * plains with rolling hills, one low lake basin (filled with water in terrain()),
 * and soft stone hills where a second noise field crosses a threshold. Everything
 * is deterministic so server and every client agree. Max height stays below
 * MAX_Y (15).
 */
export const height = (x: number, z: number) => {
  if (Math.abs(x) < 4 && Math.abs(z) < 4) return 2; // safe spawn plateau
  // Gentle plains: low-frequency rolling hills, 2..5 high.
  const roll = noise2(x / 8.5, z / 8.5);
  const plains = 2 + Math.round(roll * 3);
  // Soft stone hills: rare and rounded, peak ~9.
  const mtn = noise2(x / 11, z / 11);
  if (mtn > 0.74) return Math.min(9, 3 + Math.round((mtn - 0.74) * 22));
  // Lake basin: a separate low-frequency field dips low → dig out to y=1.
  const lake = noise2(x / 6.5, z / 6.5);
  if (lake < 0.18 && plains <= 3 && !(Math.abs(x) < 5 && Math.abs(z) < 5))
    return 1;
  return plains;
};

/** Where Minecraft-style slim trees may grow: forest bands, away from spawn. */
export function isTreeSpot(x: number, z: number): boolean {
  if (Math.abs(x) < 5 && Math.abs(z) < 5) return false; // keep spawn clear
  const top = height(x, z);
  if (top <= 1) return false; // no trees in the lake
  if (top >= 5) return false; // no trees on the stone hills
  const desert = noise2(x / 9, z / 9) < 0.22 && top <= 2;
  if (desert) return false; // no trees on the sandy flats
  const forest = noise2(x / 9 + 7.31, z / 9 + 2.17); // separate forest field
  if (forest < 0.48 || forest > 0.68) return false;
  return noise2(x, z) < 0.09; // sparse, slim trees
}

/** Deterministic pseudo-random 0..1 for a given local offset (per-tree variation). */
const treeRand = (ox: number, oy: number) => noise2(ox * 7.13, oy * 7.31);

/**
 * Build one slim, upright tree at (x, top, z): a slender uniform 5-high trunk
 * and a narrow, regular 3-wide rounded canopy. Every tree looks the same —
 * clean and tidy, no thick or thin variation. Deterministic.
 */
function plantTree(
  x: number,
  z: number,
  top: number,
  blocks: Map<string, Block>,
) {
  const trunkH = 5;
  const t = top + trunkH; // canopy base (trunk top)
  for (let i = 1; i <= trunkH; i++)
    blocks.set(key({ x, y: top + i, z }), { x, y: top + i, z, material: 'wood' });

  const put = (dx: number, dy: number, dz: number) => {
    blocks.set(key({ x: x + dx, y: t + dy, z: z + dz }), {
      x: x + dx,
      y: t + dy,
      z: z + dz,
      material: 'leaves',
    });
  };
  // Regular birch-style canopy: full 3x3, then a cross, then a single tip.
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) put(dx, 0, dz);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      if (Math.abs(dx) + Math.abs(dz) <= 1) put(dx, 1, dz);
  put(0, 2, 0);
}

/** Build the initial world: terrain + oak forests + water. Deterministic. */
export function terrain(): Map<string, Block> {
  const blocks = new Map<string, Block>();
  for (let x = -LIMIT; x <= LIMIT; x++)
    for (let z = -LIMIT; z <= LIMIT; z++) {
      const top = height(x, z);
      const desert = noise2(x / 9, z / 9) < 0.22 && top <= 2;
      const topMaterial: Material =
        top <= 0 || desert
          ? 'sand'
          : top >= 7
            ? 'stone'
            : top >= 5
              ? 'cobble'
              : 'grass';
      for (let y = 0; y <= top; y++) {
        const b: Block = {
          x,
          y,
          z,
          material:
            y === top
              ? topMaterial
              : y === 0
                ? 'cobble'
                : top >= 5
                  ? 'stone'
                  : 'dirt',
        };
        blocks.set(key(b), b);
      }
      // Minecraft-style shallow lake: one water block on top of the basin.
      if (top === 1) blocks.set(key({ x, y: 2, z }), { x, y: 2, z, material: 'water' });
      // Slim uniform forest: keep a 2-block gap so canopies never touch.
      if (isTreeSpot(x, z)) {
        const touching = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ] as Array<[number, number]>
        ).some(([dx, dz]) => {
          const nx = x + dx;
          const nz = z + dz;
          const nt = height(nx, nz);
          return blocks.get(key({ x: nx, y: nt + 1, z: nz }))?.material === 'wood';
        });
        if (!touching) plantTree(x, z, top, blocks);
      }
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
      for (let y = Math.floor(p.y + 0.5); y <= Math.floor(p.y + 1.7 + 0.5); y++) {
        const b = blocks.get(key({ x, y, z }));
        // Water is walk-through (like shallow Minecraft water).
        if (b && b.material !== 'water' && overlaps(p, b)) return true;
      }
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
    edit.material !== null && !MATERIALS.includes(edit.material)
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
