import * as THREE from 'three';

// MC-style flat voxel clouds: clusters of wide, thin white semi-transparent
// boxes drifting east and wrapping around, ported from the reference
// (source lines 1994-2012). fog:false so haze never swallows them.

interface CloudCluster {
  group: THREE.Group;
  speed: number;
}

export class CloudField {
  private clusters: CloudCluster[] = [];
  private material: THREE.MeshBasicMaterial;
  private boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private dayColor = new THREE.Color(0xffffff);
  private nightColor = new THREE.Color(0x2e3852);
  private tmpColor = new THREE.Color();

  constructor(private scene: THREE.Scene, count = 16) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < n; j++) {
        const w = 14 + Math.random() * 18;
        const h = 1.5 + Math.random() * 1.2;
        const d = 8 + Math.random() * 10;
        const mesh = new THREE.Mesh(this.boxGeometry, this.material);
        mesh.scale.set(w, h, d);
        mesh.position.set(
          Math.random() * 16 - 8,
          Math.random() * 1.5 - 0.75,
          Math.random() * 10 - 5,
        );
        group.add(mesh);
      }
      group.position.set(
        Math.random() * 300 - 150,
        52 + Math.random() * 18,
        Math.random() * 300 - 150,
      );
      scene.add(group);
      this.clusters.push({ group, speed: 0.2 + Math.random() * 0.35 });
    }
  }

  /** Drift east; wrap at ±160; tint toward dark slate at night. */
  update(dt: number, nightFactor: number) {
    for (const cloud of this.clusters) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > 160) cloud.group.position.x = -160;
    }
    this.tmpColor.lerpColors(this.dayColor, this.nightColor, nightFactor);
    this.material.color.copy(this.tmpColor);
    this.material.opacity = THREE.MathUtils.lerp(0.85, 0.45, nightFactor);
  }

  dispose() {
    for (const cloud of this.clusters) this.scene.remove(cloud.group);
    this.clusters = [];
    this.boxGeometry.dispose();
    this.material.dispose();
  }
}
