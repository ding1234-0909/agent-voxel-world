import { inBounds, key, distance } from '@voxel/shared';
import { setTimeout as pause } from 'node:timers/promises';
import type {
  Observation,
  AgentSession,
  PlannedEdit,
  BuildAction,
  BuildResult,
} from '../contracts';

export const BUILD_STEP_MS = 125;

export const MAX_BATCH_BLOCKS = 64;

export function parsePlannedEdit(value: unknown): PlannedEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('方块参数无效。');
  const a = value as PlannedEdit;
  if (
    !inBounds(a) ||
    a.y === 0 ||
    (a.material !== null &&
      !['grass', 'dirt', 'stone', 'wood'].includes(a.material))
  )
    throw Error('方块参数无效。');
  return { x: a.x, y: a.y, z: a.z, material: a.material };
}

export function parseBuildAction(
  a: Record<string, unknown>,
  allowEdits: boolean,
): BuildAction {
  if (!allowEdits) throw Error('方块修改未开启；本轮不执行。');
  if (a.type === 'build') {
    if (
      !Array.isArray(a.blocks) ||
      !a.blocks.length ||
      a.blocks.length > MAX_BATCH_BLOCKS
    )
      throw Error(`批量建造需包含 1–${MAX_BATCH_BLOCKS} 个方块。`);
    const blocks = a.blocks.map(parsePlannedEdit);
    if (new Set(blocks.map(key)).size !== blocks.length)
      throw Error('同一批次不能重复修改同一位置。');
    return { type: 'build', blocks };
  }
  const origin = parsePlannedEdit(a);
  if (
    a.type !== 'house' ||
    origin.material === null ||
    !Number.isInteger(a.width) ||
    Number(a.width) < 3 ||
    Number(a.width) > 7 ||
    !Number.isInteger(a.depth) ||
    Number(a.depth) < 3 ||
    Number(a.depth) > 7 ||
    !Number.isInteger(a.height) ||
    Number(a.height) < 4 ||
    Number(a.height) > 6 ||
    !['north', 'south', 'east', 'west'].includes(String(a.door ?? 'south'))
  )
    throw Error('房屋尺寸或门的方向无效。');
  const house: BuildAction = {
    type: 'house',
    ...origin,
    material: origin.material,
    width: Number(a.width),
    depth: Number(a.depth),
    height: Number(a.height),
    door: (a.door ?? 'south') as 'north' | 'south' | 'east' | 'west',
  };
  // Validate the entire footprint before any block can be changed.
  houseBlocks(house).forEach(parsePlannedEdit);
  return house;
}

/** Compact blueprint: foundation, hollow walls, two-block doorway, flat roof. */
export function houseBlocks(
  a: Extract<BuildAction, { type: 'house' }>,
): PlannedEdit[] {
  const blocks: PlannedEdit[] = [];
  for (let y = 0; y < a.height; y++)
    for (let z = 0; z < a.depth; z++)
      for (let x = 0; x < a.width; x++) {
        const slab = y === 0 || y === a.height - 1;
        const wall =
          x === 0 || x === a.width - 1 || z === 0 || z === a.depth - 1;
        const doorway =
          (y === 1 || y === 2) &&
          ((a.door === 'north' && z === 0 && x === Math.floor(a.width / 2)) ||
            (a.door === 'south' &&
              z === a.depth - 1 &&
              x === Math.floor(a.width / 2)) ||
            (a.door === 'west' && x === 0 && z === Math.floor(a.depth / 2)) ||
            (a.door === 'east' &&
              x === a.width - 1 &&
              z === Math.floor(a.depth / 2)));
        if (slab || (wall && !doorway))
          blocks.push({
            x: a.x + x,
            y: a.y + y,
            z: a.z + z,
            material: a.material,
          });
      }
  return blocks;
}

/** One inference drives many individually acknowledged, rate-bounded edits. */
export async function executeBuild(
  session: Pick<AgentSession, 'request'>,
  action: BuildAction,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  checkpoint: (result: BuildResult) => void = () => {},
): Promise<BuildResult> {
  const blocks = action.type === 'house' ? houseBlocks(action) : action.blocks;
  let observation = await session.request<Observation>('observe');
  let revision = observation.revision;
  let known = new Map(observation.blocks.map((b) => [key(b), b.material]));
  const result: BuildResult = {
    ok: false,
    total: blocks.length,
    completed: 0,
    skipped: 0,
    remaining: [...blocks],
    failures: [],
    note: '',
  };
  const save = () => checkpoint(structuredClone(result));
  const resolved = (block: PlannedEdit) => {
    result.remaining = result.remaining.filter((b) => key(b) !== key(block));
    save();
  };
  save();
  if (action.type === 'house') {
    const shell = new Set(blocks.map(key));
    const obstruction = observation.blocks.find(
      (b) =>
        b.x >= action.x &&
        b.x < action.x + action.width &&
        b.y >= action.y &&
        b.y < action.y + action.height &&
        b.z >= action.z &&
        b.z < action.z + action.depth &&
        !shell.has(key(b)),
    );
    if (obstruction) {
      result.remaining = blocks;
      result.failures = [
        {
          block: { ...obstruction, material: null },
          error: 'interior-occupied',
        },
      ];
      result.note =
        '房屋内部或门洞已有方块，尚未开始施工；请选择空地或明确规划清理，不会自动拆除已有地形。';
      save();
      progress(result.note);
      return result;
    }
  }
  progress(`开始连续建造 · ${blocks.length} 个方块 · 无需逐块推理`);
  for (let index = 0; index < blocks.length; index++) {
    signal.throwIfAborted();
    const block = blocks[index]!;
    // Skip confirmed matching placements or removals proven empty within the observation cutoff.
    if (
      (block.material !== null && known.get(key(block)) === block.material) ||
      (block.material === null &&
        !known.has(key(block)) &&
        observedEmpty(observation, block))
    ) {
      result.skipped++;
      resolved(block);
      continue;
    }
    if (index > 0) await pause(BUILD_STEP_MS, undefined, { signal });
    let failure: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      result.uncertain = [block];
      save();
      const reply = await session.request('edit', { ...block, revision });
      result.uncertain = [];
      save();
      revision = reply.revision;
      if (reply.ok) {
        if (block.material === null) known.delete(key(block));
        else known.set(key(block), block.material);
        result.completed++;
        resolved(block);
        failure = undefined;
        break;
      }
      failure = reply.error ?? 'unknown';
      if ((failure === 'conflict' || failure === 'occupied') && attempt === 0) {
        observation = await session.request<Observation>('observe');
        revision = observation.revision;
        known = new Map(observation.blocks.map((b) => [key(b), b.material]));
        if (
          block.material !== null &&
          known.get(key(block)) === block.material
        ) {
          result.skipped++;
          resolved(block);
          failure = undefined;
          break;
        }
        if (failure === 'occupied') break;
        await pause(BUILD_STEP_MS, undefined, { signal });
      } else break;
    }
    if (failure) {
      result.failures.push({ block, error: failure });
      save();
      if (
        ![
          'out-of-reach',
          'occupied',
          'player-occupied',
          'unsupported',
          'empty',
        ].includes(failure)
      ) {
        break;
      }
    }
    if ((index + 1) % 8 === 0)
      progress(
        `建造进度 · 新建/移除 ${result.completed} · 已存在 ${result.skipped} · 待处理 ${result.remaining.length}`,
      );
  }
  result.ok = result.remaining.length === 0;
  result.note = `建造${result.ok ? '完成' : '未完成'}：${result.completed} 个已修改，${result.skipped} 个已存在，${result.remaining.length} 个待处理。`;
  if (!result.ok)
    result.note += '根据失败原因调整位置/蓝图后重试；不要宣称房屋已完成。';
  save();
  progress(result.note);
  return result;
}

/** Absence is evidence only inside the observed radius AND the nearest-block cutoff. */
export function observedEmpty(observation: Observation, block: PlannedEdit) {
  const d = distance(observation.self, block);
  return (
    d <= observation.radius &&
    !observation.blocks.some((b) => key(b) === key(block)) &&
    (observation.blocks.length < 500 ||
      d <
        Math.max(
          ...observation.blocks.map((b) => distance(observation.self, b)),
        ))
  );
}
