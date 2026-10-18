import { agentConfig } from '../apps/agent/src/cli/deepseek-config';
import { describe, it, expect, vi } from 'vitest';
import {
  parseAction,
  executeAction,
  runAgent,
  houseBlocks,
  type BuildAction,
  type Observation,
  type Session,
} from '@voxel/agent-runtime';

const observation: Observation = {
  id: 'obs',
  revision: 4,
  radius: 8,
  blocks: [],
  players: [],
  events: [],
  allowedActions: ['edit'],
  self: {
    id: 'ai',
    name: 'builder',
    kind: 'ai-agent',
    connected: true,
    x: 0,
    y: 2.5,
    z: 0,
    yaw: 0,
  },
};
const house: Extract<BuildAction, { type: 'house' }> = {
  type: 'house',
  x: 2,
  y: 3,
  z: -1,
  width: 3,
  depth: 3,
  height: 4,
  material: 'wood',
  door: 'west',
};
const batch: BuildAction = {
  type: 'build',
  blocks: [
    { x: 1, y: 3, z: 0, material: 'wood' },
    { x: 1, y: 4, z: 0, material: 'wood' },
  ],
};
function fixture() {
  let revision = 4;
  const request = vi.fn(
    async (type: string, _payload?: unknown): Promise<unknown> =>
      type === 'observe'
        ? observation
        : { id: 'ok', ok: true, revision: ++revision },
  );
  return { request, move: vi.fn(), observe: vi.fn(async () => observation) };
}
const signal = () => new AbortController().signal;
describe('bounded multi-block construction', () => {
  it('generates supported layer order, a hollow interior, doorway and roof from compact JSON', () => {
    expect(parseAction(house, true)).toEqual(house);
    const blocks = houseBlocks(house);
    expect(blocks).toHaveLength(32);
    expect(blocks.some((b) => b.x === 3 && b.y === 4 && b.z === 0)).toBe(false);
    expect(blocks.some((b) => b.x === 2 && b.y === 4 && b.z === 0)).toBe(false);
    expect(blocks.some((b) => b.x === 3 && b.y === 6 && b.z === 0)).toBe(true);
    expect(blocks.map((b) => b.y)).toEqual(
      blocks.map((b) => b.y).sort((a, b) => a - b),
    );
  });
  it('validates the whole plan and permissions before execution', async () => {
    const s = fixture();
    for (const action of [house, batch])
      await expect(
        executeAction(
          s as unknown as Session,
          action,
          observation,
          false,
          signal(),
        ),
      ).rejects.toThrow('未开启');
    for (const bad of [
      { ...house, width: 8 },
      { ...house, height: 3 },
      { ...house, x: 25 },
      { ...house, material: null },
      { ...house, door: 'bad' },
      { ...house, y: 14 },
      { ...house, width: 3.5 },
      { type: 'build', blocks: [] },
      { type: 'build', blocks: Array(65).fill(batch.blocks[0]) },
      { type: 'build', blocks: [batch.blocks[0], batch.blocks[0]] },
      {
        type: 'build',
        blocks: [batch.blocks[0], { ...batch.blocks[1], y: 0 }],
      },
    ])
      expect(() => parseAction(bad, true)).toThrow();
    expect(s.request).not.toHaveBeenCalled();
  });
  it('uses each acknowledged revision without a model call between blocks', async () => {
    const s = fixture();
    const result = await executeAction(
      s as unknown as Session,
      batch,
      observation,
      true,
      signal(),
    );
    expect(result).toMatchObject({
      ok: true,
      total: 2,
      completed: 2,
      remaining: [],
    });
    expect(
      s.request.mock.calls.filter((c) => c[0] === 'edit').map((c) => c[1]),
    ).toEqual([
      { ...batch.blocks[0], revision: 4 },
      { ...batch.blocks[1], revision: 5 },
    ]);
  });
  it('does not enclose existing terrain inside a supposedly hollow house', async () => {
    const s = fixture();
    s.request.mockResolvedValueOnce({
      ...observation,
      blocks: [{ x: 3, y: 4, z: 0, material: 'stone' }],
    });
    expect(
      await executeAction(
        s as unknown as Session,
        house,
        observation,
        true,
        signal(),
      ),
    ).toMatchObject({
      ok: false,
      completed: 0,
      failures: [{ error: 'interior-occupied' }],
    });
    expect(s.request.mock.calls.filter((c) => c[0] === 'edit')).toHaveLength(0);
  });
  it('skips already matching blocks when resuming a plan', async () => {
    const s = fixture();
    s.request.mockResolvedValueOnce({
      ...observation,
      blocks: [batch.blocks[0]],
    });
    expect(
      await executeAction(
        s as unknown as Session,
        batch,
        observation,
        true,
        signal(),
      ),
    ).toMatchObject({ ok: true, completed: 1, skipped: 1 });
    expect(s.request.mock.calls.filter((c) => c[0] === 'edit')).toHaveLength(1);
  });
  it('reports partial failure and remaining coordinates instead of false success', async () => {
    const s = fixture();
    s.request
      .mockResolvedValueOnce(observation)
      .mockResolvedValueOnce({ ok: false, error: 'out-of-reach', revision: 4 });
    expect(
      await executeAction(
        s as unknown as Session,
        batch,
        observation,
        true,
        signal(),
      ),
    ).toMatchObject({
      ok: false,
      completed: 1,
      remaining: [batch.blocks[0]],
      failures: [{ block: batch.blocks[0], error: 'out-of-reach' }],
    });
  });
  it('refreshes a conflicted revision once and does not overwrite occupied cells', async () => {
    const s = fixture();
    s.request
      .mockResolvedValueOnce(observation)
      .mockResolvedValueOnce({ ok: false, error: 'conflict', revision: 5 })
      .mockResolvedValueOnce({ ...observation, revision: 5 })
      .mockResolvedValueOnce({ ok: true, revision: 6 })
      .mockResolvedValueOnce({ ok: false, error: 'occupied', revision: 6 })
      .mockResolvedValueOnce({
        ...observation,
        revision: 6,
        blocks: [{ ...batch.blocks[1], material: 'stone' }],
      });
    expect(
      await executeAction(
        s as unknown as Session,
        batch,
        observation,
        true,
        signal(),
      ),
    ).toMatchObject({ ok: false, completed: 1, remaining: [batch.blocks[1]] });
    expect(
      s.request.mock.calls.filter((c) => c[0] === 'edit').map((c) => c[1]),
    ).toEqual([
      { ...batch.blocks[0], revision: 4 },
      { ...batch.blocks[0], revision: 5 },
      { ...batch.blocks[1], revision: 6 },
    ]);
  });
  it('stops immediately on storage failure and retains all unattempted work', async () => {
    const s = fixture();
    s.request.mockResolvedValueOnce(observation).mockResolvedValueOnce({
      ok: false,
      error: 'storage-unavailable',
      revision: 4,
    });
    expect(
      await executeAction(
        s as unknown as Session,
        batch,
        observation,
        true,
        signal(),
      ),
    ).toMatchObject({ ok: false, completed: 0, remaining: batch.blocks });
    expect(s.request.mock.calls.filter((c) => c[0] === 'edit')).toHaveLength(1);
  });
  it('cancels between edits without sending the rest of the plan', async () => {
    const s = fixture(),
      abort = new AbortController();
    s.request
      .mockResolvedValueOnce(observation)
      .mockImplementationOnce(async () => {
        abort.abort();
        return { ok: true, revision: 5 };
      });
    await expect(
      executeAction(
        s as unknown as Session,
        batch,
        observation,
        true,
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(s.request.mock.calls.filter((c) => c[0] === 'edit')).toHaveLength(1);
  });
  it('retains an unfinished blueprint across a repositioning turn', async () => {
    const s = fixture();
    s.request
      .mockResolvedValueOnce(observation)
      .mockResolvedValueOnce({ ok: false, error: 'out-of-reach', revision: 4 });
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        actions: [{ type: 'build', blocks: [batch.blocks[0]] }],
        task: {
          intent: 'continue' as const,
          status: 'running' as const,
          summary: '测试决策',
        },
      })
      .mockResolvedValueOnce({
        actions: [{ type: 'move', x: 1, z: 0, jump: false, durationMs: 100 }],
        task: {
          intent: 'continue' as const,
          status: 'running' as const,
          summary: '测试决策',
        },
      })
      .mockResolvedValueOnce({
        actions: [{ type: 'wait' }],
        task: {
          intent: 'continue' as const,
          status: 'completed' as const,
          summary: '测试决策',
        },
      });
    await runAgent(
      s as unknown as Session,
      { decide },
      {
        ...agentConfig({ DEEPSEEK_API_KEY: 'fixture' }),
        allowEdits: true,
        maxTurns: 3,
        intervalMs: 0,
      },
      signal(),
      () => {},
    );
    expect(decide.mock.calls[2][1]).toMatchObject({
      unfinishedBuild: {
        action: { type: 'build' },
        result: { remaining: [batch.blocks[0]] },
      },
    });
  });
});
