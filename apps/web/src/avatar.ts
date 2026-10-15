import * as THREE from 'three';
import type { Player } from '@voxel/shared';

const outfits = [
  { coat: 0x426e68, trim: 0xe6b86d, hair: 0x493b32 },
  { coat: 0x536d8a, trim: 0xd9a484, hair: 0x3b302b },
  { coat: 0x98705a, trim: 0xc8d9b5, hair: 0x584735 },
];

/** Feet are at y=0 and the face points down -Z, matching world movement. */
export class VoxelAvatar extends THREE.Group {
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private materials = new Map<number, THREE.MeshStandardMaterial>();
  private torso = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private stride = 0;
  private motion = 0;

  constructor(player: Pick<Player, 'id' | 'kind'>) {
    super();
    const agent =
      player.kind === 'ai-agent' || player.kind === 'scripted-agent';
    let seed = 0;
    for (const char of player.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    const outfit = outfits[seed % outfits.length]!;
    const coat = agent ? 0xe5ba71 : outfit.coat;
    const skin = agent ? 0xe8e3cc : 0xd8aa85;
    const dark = 0x334a47;
    this.name = agent ? 'Agent companion' : 'Explorer';
    this.add(this.torso, this.leftLeg, this.rightLeg);

    // A compact silhouette with separate boots, trousers, and shoulder joints.
    for (const [side, leg] of [
      [-1, this.leftLeg],
      [1, this.rightLeg],
    ] as const) {
      leg.position.set(side * 0.145, 0.67, 0);
      this.box(leg, [0.23, 0.51, 0.27], [0, -0.255, 0], dark);
      this.box(leg, [0.25, 0.15, 0.35], [0, -0.595, -0.035], 0x30403c);
      this.box(leg, [0.255, 0.035, 0.355], [0, -0.652, -0.035], 0x6b7966);
    }
    this.box(this.torso, [0.49, 0.57, 0.31], [0, 0.96, 0], coat);
    this.box(this.torso, [0.49, 0.065, 0.325], [0, 0.705, 0], dark);
    this.box(this.torso, [0.075, 0.055, 0.022], [0, 0.705, -0.174], 0xd8cc9e);
    for (const [side, arm] of [
      [-1, this.leftArm],
      [1, this.rightArm],
    ] as const) {
      arm.position.set(side * 0.355, 1.19, 0);
      this.torso.add(arm);
      this.box(arm, [0.19, 0.36, 0.27], [0, -0.15, 0], coat);
      this.box(arm, [0.195, 0.065, 0.275], [0, -0.33, 0], dark);
      this.box(arm, [0.16, 0.15, 0.22], [0, -0.435, -0.005], skin);
    }
    this.box(this.torso, [0.18, 0.12, 0.18], [0, 1.265, 0], skin);
    this.box(this.torso, [0.46, 0.43, 0.4], [0, 1.515, -0.01], skin);

    if (agent) {
      // Friendly service robot: inset dark visor, mint eyes, headset and antenna.
      this.box(this.torso, [0.405, 0.2, 0.035], [0, 1.53, -0.222], dark);
      for (const side of [-1, 1]) {
        this.box(
          this.torso,
          [0.055, 0.075, 0.018],
          [side * 0.105, 1.54, -0.246],
          0xa8e5c5,
        );
        this.box(this.torso, [0.07, 0.17, 0.22], [side * 0.265, 1.52, 0], coat);
      }
      this.box(this.torso, [0.09, 0.025, 0.02], [0, 1.38, -0.222], dark);
      this.box(this.torso, [0.47, 0.075, 0.41], [0, 1.735, -0.01], coat);
      this.box(this.torso, [0.035, 0.1, 0.035], [0.14, 1.82, 0.02], dark);
      this.box(this.torso, [0.075, 0.055, 0.075], [0.14, 1.89, 0.02], 0x9fcdb0);
      this.box(this.torso, [0.23, 0.2, 0.025], [0, 1.04, -0.169], dark);
      this.box(
        this.torso,
        [0.055, 0.055, 0.015],
        [-0.05, 1.07, -0.19],
        0xa8e5c5,
      );
      this.box(
        this.torso,
        [0.09, 0.025, 0.015],
        [0.045, 1.01, -0.19],
        0xe5ba71,
      );
      this.box(this.torso, [0.32, 0.38, 0.16], [0, 0.99, 0.22], dark);
      this.box(this.torso, [0.2, 0.06, 0.025], [0, 1.04, 0.31], 0xa8e5c5);
    } else {
      // Field explorer: swept hair under a cap, scarf, jacket pockets and pack.
      this.box(this.torso, [0.48, 0.15, 0.42], [0, 1.695, -0.005], outfit.hair);
      this.box(this.torso, [0.48, 0.23, 0.09], [0, 1.55, 0.165], outfit.hair);
      this.box(
        this.torso,
        [0.12, 0.12, 0.035],
        [-0.165, 1.615, -0.222],
        outfit.hair,
      );
      this.box(this.torso, [0.5, 0.1, 0.43], [0, 1.78, 0], coat);
      this.box(this.torso, [0.52, 0.035, 0.2], [0, 1.727, -0.23], coat);
      for (const side of [-1, 1]) {
        this.box(
          this.torso,
          [0.047, 0.057, 0.018],
          [side * 0.105, 1.535, -0.22],
          0x313d35,
        );
        this.box(
          this.torso,
          [0.07, 0.055, 0.022],
          [side * 0.145, 1.45, -0.22],
          0xc58c70,
        );
        this.box(
          this.torso,
          [0.13, 0.14, 0.025],
          [side * 0.135, 0.94, -0.171],
          outfit.trim,
        );
        this.box(
          this.torso,
          [0.055, 0.48, 0.027],
          [side * 0.17, 1.005, 0.17],
          0x8a7250,
        );
      }
      this.box(this.torso, [0.065, 0.023, 0.018], [0, 1.425, -0.222], 0x805749);
      this.box(
        this.torso,
        [0.34, 0.085, 0.35],
        [0, 1.275, -0.015],
        outfit.trim,
      );
      this.box(
        this.torso,
        [0.11, 0.19, 0.04],
        [-0.09, 1.17, -0.19],
        outfit.trim,
      );
      this.box(this.torso, [0.34, 0.4, 0.2], [0, 1.02, 0.25], 0x89734e);
      this.box(this.torso, [0.36, 0.1, 0.22], [0, 1.2, 0.25], outfit.trim);
      this.box(this.torso, [0.06, 0.2, 0.025], [0, 1.02, 0.363], outfit.trim);
    }
  }

  private box(
    parent: THREE.Group,
    size: number[],
    position: number[],
    color: number,
  ) {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      this.materials.set(color, material);
    }
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    mesh.position.set(position[0]!, position[1]!, position[2]!);
    parent.add(mesh);
  }

  animate(dt: number, speed: number) {
    this.motion = THREE.MathUtils.lerp(
      this.motion,
      Math.min(speed / 3, 1),
      1 - Math.exp(-12 * dt),
    );
    this.stride += Math.min(speed, 5) * dt * 3.5;
    const swing = Math.sin(this.stride) * 0.52 * this.motion;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.8;
    this.rightArm.rotation.x = swing * 0.8;
    this.torso.position.y =
      Math.abs(Math.sin(this.stride)) * 0.025 * this.motion;
  }

  dispose() {
    this.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
