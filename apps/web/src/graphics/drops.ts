import * as THREE from 'three';
import type { Material, Vec3 } from '@voxel/shared';
import { inventory } from '../game/inventory';
import { sfx } from '../game/sounds';
import { drawItemIcon, isPlaceable, type ItemId } from '../game/items';
import { blockMaterialBundle } from './block-materials';

// ============================================================================
// 掉落物 + 拾取（移植自源码 2372-2412）：破坏确认后生成 0.28 小盒，抛掷
// 物理（vy 3.5-5.5、重力 22、水平阻尼），落地后自旋 + 轻微浮动，生命周期
// 30 秒；玩家距离平方 <2.2 时拾取进背包并播放 pickup 音效。仅本地表现。
// MC 规则：破坏 'stone' 掉落 'cobble'，其他方块掉落自身材质。
// ============================================================================

/** Which inventory item id a broken block yields (stone → cobble; water drops nothing). */
export const dropForBreak = (m: Material): ItemId | null =>
  m === 'stone'
    ? 'cobble'
    : m === 'water' || m === 'snow' || m === 'ice'
      ? null
      : m;

const DROP_SIZE = 0.28;
const GRAVITY = 22;
const LIFE = 30;
const MAX_DROPS = 80;
const PICKUP_SQ = 2.2;

const dropGeo = new THREE.BoxGeometry(DROP_SIZE, DROP_SIZE, DROP_SIZE);
// Non-block item icons drawn once to a 32px pixel CanvasTexture and cached.
const iconTextureCache = new Map<ItemId, THREE.CanvasTexture>();

function iconTexture(id: ItemId): THREE.CanvasTexture {
  let tex = iconTextureCache.get(id);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  drawItemIcon(canvas, id);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  iconTextureCache.set(id, tex);
  return tex;
}

interface Drop {
  mesh: THREE.Mesh;
  id: ItemId;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  bob: number;
  baseY: number;
  life: number;
  grounded: boolean;
  ownMaterial: boolean;
}

export class DropField {
  private drops: Drop[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Spawn a tossed item at integer block cell (x, y, z). */
  spawn(x: number, y: number, z: number, id: ItemId) {
    if (this.drops.length >= MAX_DROPS) this.removeAt(0);
    let material: THREE.Material | THREE.Material[];
    let ownMaterial = false;
    if (isPlaceable(id)) {
      // Reuse the block's 6-face bundle (grass/workbench multi-material).
      material = blockMaterialBundle(id as Material, 0).material;
    } else {
      material = new THREE.MeshStandardMaterial({
        map: iconTexture(id),
        roughness: 0.85,
        metalness: 0,
      });
      ownMaterial = true;
    }
    const mesh = new THREE.Mesh(dropGeo, material);
    mesh.position.set(
      x + 0.5 + Math.random() * 0.4 - 0.2,
      y + 0.6,
      z + 0.5 + Math.random() * 0.4 - 0.2,
    );
    this.scene.add(mesh);
    this.drops.push({
      mesh,
      id,
      vx: (Math.random() - 0.5) * 2.5,
      vy: 3.5 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 2.5,
      spin: 2 + Math.random() * 3,
      bob: Math.random() * Math.PI * 2,
      baseY: 0,
      life: LIFE,
      grounded: false,
      ownMaterial,
    });
  }

  update(
    dt: number,
    self: Vec3 | undefined,
    isSolid: (x: number, y: number, z: number) => boolean,
  ) {
    const damp = Math.pow(0.9, dt * 60);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.life -= dt;
      if (d.life <= 0) {
        this.removeAt(i);
        continue;
      }
      if (!d.grounded) {
        d.vy -= GRAVITY * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.vx *= damp;
        d.vz *= damp;
        const bx = Math.floor(d.mesh.position.x);
        const by = Math.floor(d.mesh.position.y);
        const bz = Math.floor(d.mesh.position.z);
        if ((by >= 0 && isSolid(bx, by, bz)) || by < 0) {
          d.grounded = true;
          d.baseY = (by < 0 ? 0 : by) + 1 + DROP_SIZE / 2;
          d.mesh.position.y = d.baseY;
          d.vy = 0;
          d.vx = 0;
          d.vz = 0;
        }
      } else {
        d.bob += dt * 3;
        d.mesh.position.y = d.baseY + Math.sin(d.bob) * 0.05;
      }
      d.mesh.rotation.y += d.spin * dt;
      // Pickup when close to the player's body center.
      if (self) {
        const dx = d.mesh.position.x - self.x;
        const dy = d.mesh.position.y - (self.y + 0.9);
        const dz = d.mesh.position.z - self.z;
        if (dx * dx + dy * dy + dz * dz < PICKUP_SQ) {
          if (inventory.add(d.id, 1) > 0) {
            sfx.pickup();
            this.removeAt(i);
            continue;
          }
          // Backpack full: leave the item on the ground.
        }
      }
    }
  }

  private removeAt(index: number) {
    const d = this.drops[index]!;
    this.scene.remove(d.mesh);
    if (d.ownMaterial) {
      const mat = d.mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    this.drops.splice(index, 1);
  }

  dispose() {
    for (let i = this.drops.length - 1; i >= 0; i--) this.removeAt(i);
    for (const tex of iconTextureCache.values()) tex.dispose();
    iconTextureCache.clear();
  }
}
