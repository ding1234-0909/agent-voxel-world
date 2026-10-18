import * as THREE from 'three';
import { key, type Block } from '@voxel/shared';

// ============================================================================
// 地面细节：小草与野花（移植自源码 1899-1960）。
// 修复：草叶贴住方块顶面（顶面在 y+0.5，之前误用 y+1 导致悬空半格）。
// 升级：Minecraft 风格——草不铺满，约 55% 的草格长出 1-2 根短草尖，纯色鲜
// 绿（深/浅两档），高度更贴地，稀疏自然，不再像纸片或密集的草皮贴纸。
// 仅本地装饰，确定性 hash，所有客户端一致，无需服务器同步。
// ============================================================================

/** Deterministic per-cell hash (source line 1230), returns [0, 1). */
function hashN(x: number, y: number, z: number): number {
  let n =
    (Math.imul(x, 374761393) + Math.imul(y, 668265263) + z * 974711 + 20261008) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

/** A single grass blade: narrow, slightly tapered quad standing upright. */
function makeBladeGeometry(width = 0.07, height = 0.55): THREE.BufferGeometry {
  const p = new Float32Array([
    -width, 0, 0, width, 0, 0, -width, height, 0,
    -width, height, 0, width, 0, 0, width, height, 0,
  ]);
  const n = new Float32Array(36);
  for (let i = 0; i < 36; i += 3) {
    n[i] = 0;
    n[i + 1] = 1;
    n[i + 2] = 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

/** Tiny flat cross for flowers (keep the original flower look). */
function makeCrossGeo(w: number, h: number): THREE.BufferGeometry {
  const p = new Float32Array([
    -w, 0, 0, w, 0, 0, -w, h, 0,
    -w, h, 0, w, 0, 0, w, h, 0,
    0, 0, -w, 0, 0, w, 0, h, -w,
    0, h, -w, 0, 0, w, 0, h, w,
  ]);
  const n = new Float32Array(36);
  for (let i = 0; i < 36; i += 3) {
    n[i] = 0;
    n[i + 1] = 1;
    n[i + 2] = 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

const FLOWER_COLORS = [
  0xffffff,
  0xffd94d,
  0xf78ac2,
  0xb48ae0,
  0xff8a4d,
  0xff6b6b,
];
// Grass: sparse Minecraft-style tufts. About 55% of grass cells get 1-2 short
// blades in solid green (deep/shallow), staying low and close to the surface.
// Flowers stay sparse too.
const MAX_BLADE = 6000;
const MAX_FLOWER = 400;
const BLADE_TALL_COLOR = 0x5f9e2f; // deep green
const BLADE_SHORT_COLOR = 0x79bd4a; // fresher green

export class Foliage {
  private meshes: THREE.InstancedMesh[] = [];
  private built = false;
  private tmpColor = new THREE.Color();

  constructor(private scene: THREE.Scene) {}

  /** Build once from the current block map; safe to call again before build. */
  build(blocks: Map<string, Block>) {
    if (this.built) return;
    this.built = true;

    // Two blade lengths for a layered, tufted look in solid Minecraft green.
    const tallGeo = makeBladeGeometry(0.06, 0.55);
    const shortGeo = makeBladeGeometry(0.07, 0.36);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: BLADE_TALL_COLOR,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    const shortMat = new THREE.MeshStandardMaterial({
      color: BLADE_SHORT_COLOR,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    const blades = new THREE.InstancedMesh(tallGeo, bladeMat, MAX_BLADE);
    const shortBlades = new THREE.InstancedMesh(shortGeo, shortMat, MAX_BLADE);
    const flowers = new THREE.InstancedMesh(
      makeCrossGeo(0.14, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
      MAX_FLOWER,
    );

    const dummy = new THREE.Object3D();
    let bi = 0;
    let si = 0;
    let fi = 0;

    for (const b of blocks.values()) {
      if (b.material !== 'grass') continue;
      // Skip cells covered from above (tree trunks, player builds).
      if (blocks.has(key({ x: b.x, y: b.y + 1, z: b.z }))) continue;
      const h0 = hashN(b.x, 40, b.z); // whether this cell has grass at all
      const h1 = hashN(b.x, 1, b.z);
      const h2 = hashN(b.x, 2, b.z);
      const h3 = hashN(b.x, 3, b.z);
      const h4 = hashN(b.x, 4, b.z);
      // Sparse: only ~55% of cells grow tufts, and each tuft is 1-2 blades,
      // positioned low on the surface (y + 0.5) so nothing floats.
      const baseY = b.y + 0.5;
      if (h0 < 0.55) {
        const count = 1 + (hashN(b.x, 50, b.z) < 0.5 ? 1 : 0);
        for (let k = 0; k < count; k++) {
          const hx = hashN(b.x, 10 + k, b.z);
          const hz = hashN(b.x, 20 + k, b.z);
          const hh = hashN(b.x, 30 + k, b.z);
          const useShort = hh < 0.45;
          const idx = useShort ? si : bi;
          if (idx >= MAX_BLADE) continue;
          dummy.position.set(
            b.x + 0.15 + hx * 0.7,
            baseY,
            b.z + 0.15 + hz * 0.7,
          );
          dummy.rotation.set(
            (hx - 0.5) * 0.3,
            hx * Math.PI * 2,
            (hz - 0.5) * 0.3,
          );
          const scale = useShort ? 0.55 + hh * 0.3 : 0.65 + hh * 0.35;
          dummy.scale.set(1, scale, 1);
          dummy.updateMatrix();
          if (useShort) {
            shortBlades.setMatrixAt(si++, dummy.matrix);
          } else {
            blades.setMatrixAt(bi++, dummy.matrix);
          }
        }
      }
      // Flowers stay on top of the grass.
      if (h4 < 0.09 && fi < MAX_FLOWER) {
        dummy.position.set(
          b.x + 0.3 + h1 * 0.4,
          baseY + 0.06,
          b.z + 0.3 + h2 * 0.4,
        );
        dummy.rotation.set(0, h3 * Math.PI * 2, 0);
        const s = 0.8 + h3 * 0.5;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        flowers.setMatrixAt(fi, dummy.matrix);
        this.tmpColor.setHex(
          FLOWER_COLORS[Math.floor(h4 * FLOWER_COLORS.length)]!,
        );
        flowers.setColorAt(fi, this.tmpColor);
        fi++;
      }
    }

    blades.count = bi;
    shortBlades.count = si;
    flowers.count = fi;
    for (const mesh of [blades, shortBlades, flowers]) {
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    this.meshes = [];
  }
}
