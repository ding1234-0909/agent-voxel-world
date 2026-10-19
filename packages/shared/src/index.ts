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
export const LIMIT = 36;
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
  | 'water'
  | 'snow'
  | 'ice';
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
  'snow',
  'ice',
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
  extent?: number;
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
/**
 * Runtime world extent: starts at LIMIT and grows as the server streams new
 * terrain around players ("walk anywhere, the world generates under you").
 * Server and client keep their own copies; the server extends its copy first,
 * then broadcasts the new extent so clients stay in sync.
 */
export let WORLD_EXTENT = LIMIT;
export const setWorldExtent = (value: number) => {
  WORLD_EXTENT = Math.max(LIMIT, Math.floor(value));
};
export const inBounds = (p: Vec3) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  Math.abs(p.x) <= WORLD_EXTENT &&
  Math.abs(p.z) <= WORLD_EXTENT &&
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
 * Biomes: deterministic, seed-like noise fields so server and every client
 * agree. Walking far in any direction streams new terrain with variety —
 * snowy tundra, tall mountains, winding rivers, deserts, lakes and plains.
 */
export type Biome =
  | 'plains'
  | 'hills'
  | 'mountains'
  | 'tundra'
  | 'river'
  | 'lake'
  | 'desert';

export function biomeAt(x: number, z: number): Biome {
  // Wide open spawn meadow so players can always walk out; mountains wait
  // further away and are easy to go around.
  if (Math.abs(x) < 8 && Math.abs(z) < 8) return 'plains';
  // Snowy tundra: a broad low-frequency climate field.
  if (noise2(x / 15 + 5.7, z / 15 + 3.1) < 0.2) return 'tundra';
  // Tall mountains: rare, high-amplitude field.
  if (noise2(x / 13, z / 13) > 0.74) return 'mountains';
  // Winding river: thin threshold band of a displaced field.
  if (noise2(x / 8 + 9.1, z / 8 + 6.3) < 0.1) return 'river';
  // Lake basin: existing low-frequency dip.
  const plains = 2 + Math.round(noise2(x / 8.5, z / 8.5) * 3);
  if (noise2(x / 6.5, z / 6.5) < 0.18 && plains <= 3) return 'lake';
  // Sandy desert flats.
  if (noise2(x / 9, z / 9) < 0.2) return 'desert';
  // Soft rounded stone hills.
  if (noise2(x / 11, z / 11) > 0.74) return 'hills';
  return 'plains';
}

/**
 * Terrain height by biome, 0..15, deterministic. Spawn stays a flat plateau;
 * mountains can reach MAX_Y, rivers dig down to y=0 (water on top).
 */
export const height = (x: number, z: number) => {
  if (Math.abs(x) < 8 && Math.abs(z) < 8) return 2; // safe open spawn meadow
  const b = biomeAt(x, z);
  // All biomes share a gentle, continuous elevation band (1..7) so biome
  // borders never form unclimbable cliffs: hills roll up, mountains grow
  // from the same ground level the way real terrain does.
  if (b === 'tundra') return 2 + Math.round(noise2(x / 9, z / 9) * 2); // 2..4 snow field
  if (b === 'mountains') {
    const mtn = noise2(x / 13, z / 13);
    return Math.min(7, 2 + Math.round((mtn - 0.74) * 20)); // foothills 2 → peaks 7
  }
  if (b === 'river') return 1; // shallow river bed (water on top at y=2)
  if (b === 'lake') return 1;
  if (b === 'desert') return 2 + Math.round(noise2(x / 9, z / 9) * 2); // 2..4 sand dunes
  const roll = noise2(x / 8.5, z / 8.5);
  const plains = 2 + Math.round(roll * 2);
  if (b === 'hills') {
    const mtn = noise2(x / 11, z / 11);
    return Math.min(6, 2 + Math.round((mtn - 0.74) * 16)); // rolling 2..6
  }
  return plains;
};

/** Where Minecraft-style slim trees may grow: forest bands, away from spawn. */
export function isTreeSpot(x: number, z: number): boolean {
  if (Math.abs(x) < 8 && Math.abs(z) < 8) return false; // keep spawn clear
  const b = biomeAt(x, z);
  if (b !== 'plains' && b !== 'hills') return false; // tundra/mountains/river/lake/desert stay treeless
  const top = height(x, z);
  if (top <= 1 || top >= 5) return false;
  const forest = noise2(x / 9 + 7.31, z / 9 + 2.17); // separate forest field
  if (forest < 0.52 || forest > 0.64) return false;
  return noise2(x, z) < 0.06; // sparse, slim trees
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

/**
 * Build terrain inside [minX..maxX] × [minZ..maxZ], appending into `blocks`
 * (which may already hold neighbouring terrain, so tree spacing stays clean
 * across chunk borders). Deterministic; used for the initial world and for
 * streaming new chunks as players walk outward.
 */
export function terrainRange(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  blocks: Map<string, Block> = new Map(),
  added?: Block[],
): Map<string, Block> {
  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++) {
      const top = height(x, z);
      const b = biomeAt(x, z);
      const desert = b === 'desert' || b === 'river' || b === 'lake';
      const snow = b === 'tundra';
      const rocky = b === 'mountains';
      let topMaterial: Material;
      if (snow) topMaterial = 'snow';
      else if (rocky) topMaterial = top >= 9 ? 'stone' : 'cobble';
      else if (desert) topMaterial = 'sand';
      else topMaterial = top >= 7 ? 'stone' : top >= 5 ? 'cobble' : 'grass';
      for (let y = 0; y <= top; y++) {
        const material: Material =
          y === top
            ? topMaterial
            : y === 0
              ? 'cobble'
              : rocky || top >= 5
                ? 'stone'
                : 'dirt';
        const block = { x, y, z, material };
        blocks.set(key(block), block);
        added?.push(block);
      }
      // Water: shallow lake (one block) or a slightly deeper river channel.
      if (top === 1) {
        const w = { x, y: 2, z, material: 'water' as Material };
        blocks.set(key(w), w);
        added?.push(w);
      }
      if (top === 0) {
        for (const wy of [1, 2]) {
          const w = { x, y: wy, z, material: 'water' as Material };
          blocks.set(key(w), w);
          added?.push(w);
        }
      }
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

/** Build the initial world: terrain + oak forests + water. Deterministic. */
export function terrain(): Map<string, Block> {
  return terrainRange(-LIMIT, -LIMIT, LIMIT, LIMIT);
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
  if (
    Math.abs(p.x) > WORLD_EXTENT - 0.3 ||
    Math.abs(p.z) > WORLD_EXTENT - 0.3 ||
    p.y < 0.5
  )
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
    if (!collides(next, blocks)) {
      body[axis] = next[axis];
    } else {
      // Minecraft-style auto step: climb small bumps (up to 2 blocks) so
      // terrain variety doesn't wall you off; tall cliffs still need a walk-around.
      for (const lift of [1, 2]) {
        const stepped = { ...next, y: body.y + lift };
        if (!collides(stepped, blocks)) {
          body[axis] = next[axis];
          body.y = stepped.y;
          break;
        }
      }
    }
  }
  if (input.jump && body.grounded) {
    body.vy = 9; // ~2-block hop: hops over slim tree trunks, closer to Minecraft
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
