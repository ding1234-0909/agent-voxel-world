import * as THREE from 'three';
import type { Player } from '@voxel/shared';
import { AvatarNameplate } from './avatar-nameplate';
import {
  skinBundleFor,
  STEVE_PALETTE,
  ALEX_PALETTE,
  type SkinPalette,
} from './mc-skin';

// MC-standard voxel proportions: head 0.5, body 0.5x0.75x0.25, limbs
// 0.25x0.75x0.25, shoes. Shared geometries across all avatars.
const HEAD_GEO = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const BODY_GEO = new THREE.BoxGeometry(0.5, 0.75, 0.25);
const LIMB_GEO = new THREE.BoxGeometry(0.25, 0.75, 0.25);
const SHOE_GEO = new THREE.BoxGeometry(0.27, 0.15, 0.3);

/** Feet are at y=0 and the face points down -Z, matching world movement. */
export class VoxelAvatar extends THREE.Group {
  readonly nameplate = new AvatarNameplate();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private headGroup = new THREE.Group();
  private mouth: THREE.Mesh;
  private stride = 0;
  private motion = 0;

  constructor(
    player: Pick<Player, 'id' | 'kind'>,
    palette?: SkinPalette,
  ) {
    super();
    const agent =
      player.kind === 'ai-agent' || player.kind === 'scripted-agent';
    const skinPalette: SkinPalette =
      palette ?? (agent ? STEVE_PALETTE : ALEX_PALETTE);
    const skin = skinBundleFor(skinPalette);
    this.name = player.kind === 'ai-agent' ? 'Agent' : 'Alex';
    this.add(this.leftLeg, this.rightLeg, this.headGroup, this.nameplate);

    // Legs with shoes
    for (const [side, leg] of [
      [-1, this.leftLeg],
      [1, this.rightLeg],
    ] as const) {
      leg.position.set(side * 0.125, 0.75, 0);
      this.skinned(leg, LIMB_GEO, skin.leg, [0, -0.375, 0]);
      this.skinned(leg, SHOE_GEO, skin.shoe, [0, -0.77, 0.02]);
    }
    // Body (chest + torso)
    this.skinned(this, BODY_GEO, skin.body, [0, 1.125, 0]);
    // Arms, pivot at the shoulders
    for (const [side, arm] of [
      [-1, this.leftArm],
      [1, this.rightArm],
    ] as const) {
      arm.position.set(side * 0.375, 1.5, 0);
      this.skinned(arm, LIMB_GEO, skin.arm, [0, -0.375, 0]);
      this.add(arm);
    }
    // Head, close to the shoulders
    this.headGroup.position.set(0, 1.7, 0);
    this.skinned(this.headGroup, HEAD_GEO, skin.head, [0, 0, 0]);
    // Mouth for talk animation (companion avatars only need it, harmless here)
    this.mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.02, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.9 }),
    );
    this.mouth.position.set(0, -0.1, 0.255);
    this.mouth.castShadow = true;
    this.headGroup.add(this.mouth);
  }

  private skinned(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    materials: THREE.Material[],
    position: number[],
  ) {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(position[0]!, position[1]!, position[2]!);
    parent.add(mesh);
  }

  /** Move the mouth open/closed (talking); reset with amplitude 0. */
  talk(amplitude: number) {
    this.mouth.scale.y = 1 + Math.max(0, amplitude);
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
    this.headGroup.position.y =
      1.7 + Math.abs(Math.sin(this.stride)) * 0.02 * this.motion;
  }

  dispose() {
    this.nameplate.dispose();
    this.mouth.geometry.dispose();
    // Shared geometries and skin materials are module-level and kept alive.
  }
}
