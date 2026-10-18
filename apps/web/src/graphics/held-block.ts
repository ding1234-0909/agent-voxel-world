import * as THREE from 'three';
import type { Material } from '@voxel/shared';

// First-person held block, ported from reference lines 3272-3294: a small cube
// pinned near the bottom-center-right of the view (above the hotbar, clear of
// the chat panel), showing the selected game material, with a walk bob driven
// by estimated horizontal speed. Kept away from screen center so it never
// covers the crosshair or raycast target.

// Lower-center-right, above the hotbar and clear of the chat panel and crosshair.
const BASE_POS = new THREE.Vector3(0.32, -0.3, -0.7);
const BASE_ROT = new THREE.Euler(0.18, -0.35, 0.08);

export class HeldBlock {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private swing = 0;
  private current?: Material;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.38, 0.38),
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, fog: false }),
    );
    this.material = this.mesh.material as THREE.MeshStandardMaterial;
    // Viewmodel: draw on top of the world so terrain never occludes it, and keep
    // it clear of the screen-center crosshair / raycast target.
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.mesh.renderOrder = 999;
    this.mesh.position.copy(BASE_POS);
    this.mesh.rotation.copy(BASE_ROT);
    camera.add(this.mesh);
  }

  /** Sync to the currently selected game material (called every frame). */
  setMaterial(game: Material, texture: THREE.Texture | undefined) {
    this.current = game;
    this.mesh.visible = !!texture;
    if (texture && this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
  }

  /** Show a non-block item icon texture (tools/food) instead of a block. */
  showTexture(texture: THREE.Texture | undefined) {
    this.current = undefined;
    this.mesh.visible = !!texture;
    if (texture && this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
  }

  /** Walk bob; speed is horizontal units/second estimated on the client. */
  update(dt: number, speed: number) {
    this.swing += speed * dt * 2.2;
    this.mesh.position.x = BASE_POS.x + Math.sin(this.swing) * 0.025;
    this.mesh.position.y = BASE_POS.y + Math.abs(Math.cos(this.swing)) * 0.03;
    this.mesh.rotation.z = BASE_ROT.z + Math.sin(this.swing) * 0.04;
  }

  dispose() {
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
