import { PrismaClient } from '@prisma/client';
import {
  key,
  WORLD_ID,
  type Edit,
  type Block,
  type Material,
} from '@voxel/shared';
export class WorldStore {
  readonly mode: 'postgresql' | 'memory';
  private db?: PrismaClient;
  constructor() {
    this.mode = process.env.DATABASE_URL ? 'postgresql' : 'memory';
    if (this.mode === 'postgresql') this.db = new PrismaClient();
  }
  async load(blocks: Map<string, Block>) {
    if (!this.db) return 0;
    const world = await this.db.world.upsert({
      where: { id: WORLD_ID },
      create: { id: WORLD_ID },
      update: {},
      include: { edits: true },
    });
    for (const e of world.edits) {
      if (e.material === null) blocks.delete(key(e));
      else
        blocks.set(key(e), {
          x: e.x,
          y: e.y,
          z: e.z,
          material: e.material as Material,
        });
    }
    return world.revision;
  }
  async save(edit: Edit) {
    if (!this.db) return;
    await this.db.$transaction(async (tx) => {
      const result = await tx.world.updateMany({
        where: { id: WORLD_ID, revision: edit.revision },
        data: { revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new Error('storage-conflict');
      const { x, y, z, material } = edit;
      await tx.blockEdit.upsert({
        where: { worldId_x_y_z: { worldId: WORLD_ID, x, y, z } },
        create: { worldId: WORLD_ID, x, y, z, material },
        update: { material },
      });
    });
  }
  async close() {
    await this.db?.$disconnect();
  }
}
