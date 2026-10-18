import * as THREE from 'three';
import { ITEMS, type ItemId } from '../game/items';

// ============================================================================
// 破坏粒子（移植自源码 2348-2371）：破坏时在方块位置爆出 10 个小立方，
// 颜色取 ITEMS[material].color（源码 PCOLORS），随机初速度、重力 14、
// 自旋、0.45-0.8s 淡出。对象池复用 mesh/材质，全场景销毁时统一 dispose。
// 仅本地表现，不参与多人同步。
// ============================================================================

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  rx: number;
  ry: number;
  active: boolean;
}

const PARTICLE_COUNT = 10;
const GRAVITY = 14;
const MAX_POOL = 240;
// Shared unit cube; scaled per particle. Never disposed here (scene teardown
// traversal handles cleanup; disposal is idempotent in three).
const unitBox = new THREE.BoxGeometry(1, 1, 1);

export class BreakParticles {
  private pool: Particle[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Burst 10 colored debris cubes at integer block cell (x, y, z). */
  spawn(x: number, y: number, z: number, item: ItemId) {
    const color = ITEMS[item]?.color ?? 0x888888;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.acquire();
      if (!p) return;
      const s = 0.07 + Math.random() * 0.06;
      p.mesh.scale.setScalar(s);
      p.mesh.position.set(
        x + 0.5 + Math.random() * 0.6 - 0.3,
        y + 0.5 + Math.random() * 0.6 - 0.3,
        z + 0.5 + Math.random() * 0.6 - 0.3,
      );
      p.vx = (Math.random() - 0.5) * 4.5;
      p.vy = Math.random() * 3.5 + 1.5;
      p.vz = (Math.random() - 0.5) * 4.5;
      p.life = 0.45 + Math.random() * 0.35;
      p.max = 0.8;
      p.rx = Math.random() * 8;
      p.ry = Math.random() * 10;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = 1;
      p.mesh.visible = true;
    }
  }

  private acquire(): Particle | null {
    let p = this.pool.find((candidate) => !candidate.active);
    if (!p) {
      if (this.pool.length >= MAX_POOL) return null;
      const mesh = new THREE.Mesh(
        unitBox,
        new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      p = {
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        max: 0.8,
        rx: 0,
        ry: 0,
        active: false,
      };
      this.pool.push(p);
    }
    p.active = true;
    return p;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy -= GRAVITY * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        p.life / p.max,
      );
    }
  }

  dispose() {
    for (const p of this.pool) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
  }
}
