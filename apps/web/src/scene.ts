import * as THREE from 'three';
import { REACH, type Block, type Material } from '@voxel/shared';
import { Connection } from './connection';
const colors = {
  grass: 0x6b9c52,
  dirt: 0x9c7353,
  stone: 0x8c999b,
  wood: 0xc19766,
};
export class WorldScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 150);
  private meshes: THREE.InstancedMesh[] = [];
  private avatars = new Map<string, THREE.Group>();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.35;
  private last = 0;
  private lastSend = 0;
  private raf = 0;
  private ray = new THREE.Raycaster();
  private highlight: THREE.LineSegments;
  private selected?: { block: Block; normal: THREE.Vector3 };
  material: Material = 'wood';
  onTarget = (text: string) => {};
  constructor(
    private host: HTMLDivElement,
    private connection: Connection,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', '3D voxel world');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xc6e2e7);
    this.scene.fog = new THREE.Fog(0xc6e2e7, 25, 65);
    this.scene.add(new THREE.HemisphereLight(0xdff7ff, 0x536339, 2.5));
    const sun = new THREE.DirectionalLight(0xffecc6, 3);
    sun.position.set(14, 25, 10);
    this.scene.add(sun);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x7aaeb6, roughness: 0.5 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.55;
    this.scene.add(sea);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.014, 1.014, 1.014)),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('pointerlockchange', this.blur);
    document.addEventListener('mousemove', this.mousemove);
    host.addEventListener('mousedown', this.mouse);
    host.addEventListener('contextmenu', this.context);
    this.camera.position.set(0, 6, 8);
    this.camera.lookAt(0, 2, 0);
    this.rebuild();
    this.raf = requestAnimationFrame(this.frame);
  }
  rebuild = () => {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes = [];
    for (const material of Object.keys(colors) as Material[]) {
      const blocks = [...this.connection.blocks.values()].filter(
        (b) => b.material === material,
      );
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: colors[material],
          roughness: 1,
        }),
        blocks.length,
      );
      const matrix = new THREE.Matrix4();
      blocks.forEach((b, i) => {
        matrix.makeTranslation(b.x, b.y, b.z);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.userData.blocks = blocks;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  };
  private resize = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  private keydown = (event: KeyboardEvent) => {
    if (this.connection.status !== 'connected') return;
    if (document.querySelector('dialog[open]')) return;
    if ((event.target as HTMLElement).matches('input,textarea,button,select'))
      return;
    this.keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  };
  private keyup = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private blur = () => {
    this.keys.clear();
  };
  private context = (event: Event) => event.preventDefault();
  private mousemove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.yaw -= event.movementX * 0.002;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * 0.002,
      -1.45,
      1.45,
    );
  };
  private mouse = (event: MouseEvent) => {
    if (this.connection.status !== 'connected') return;
    if (document.pointerLockElement !== this.renderer.domElement) {
      void this.renderer.domElement.requestPointerLock();
      return;
    }
    if (event.button === 0) this.edit(false);
    if (event.button === 2) this.edit(true);
  };
  edit(place: boolean) {
    if (!this.selected) return;
    const { block, normal } = this.selected;
    this.connection.action('edit', {
      x: block.x + (place ? normal.x : 0),
      y: block.y + (place ? normal.y : 0),
      z: block.z + (place ? normal.z : 0),
      material: place ? this.material : null,
      revision: this.connection.revision,
    });
  }
  private frame = (time: number) => {
    const dt = Math.min((time - this.last) / 1000, 0.1);
    this.last = time;
    const self = this.connection.self;
    if (self) {
      const target = new THREE.Vector3(self.x, self.y + 1.5, self.z);
      this.camera.position.lerp(target, 1 - Math.exp(-20 * dt));
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    if (time - this.lastSend > 50) {
      this.lastSend = time;
      const f = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
        s = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      const len = Math.max(1, Math.hypot(f, s));
      this.connection.action('move', {
        x: (s * Math.cos(this.yaw) - f * Math.sin(this.yaw)) / len,
        z: (-s * Math.sin(this.yaw) - f * Math.cos(this.yaw)) / len,
        jump: this.keys.has('Space'),
        yaw: this.yaw,
      });
    }
    const ids = new Set(
      this.connection.players.filter((p) => p.id !== self?.id).map((p) => p.id),
    );
    for (const [id, avatar] of this.avatars)
      if (!ids.has(id)) {
        this.scene.remove(avatar);
        avatar.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            o.material.dispose();
          }
        });
        this.avatars.delete(id);
      }
    for (const p of this.connection.players) {
      if (p.id === self?.id) continue;
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 1, 0.4),
          new THREE.MeshStandardMaterial({
            color:
              p.kind === 'scripted-agent' || p.kind === 'ai-agent'
                ? 0xefac56
                : 0x527da2,
          }),
        );
        body.position.y = 0.7;
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.5, 0.5),
          new THREE.MeshStandardMaterial({ color: 0xe3c8a1 }),
        );
        head.position.y = 1.45;
        avatar.add(body, head);
        avatar.position.set(p.x, p.y, p.z);
        this.avatars.set(p.id, avatar);
        this.scene.add(avatar);
      }
      avatar.position.lerp(
        new THREE.Vector3(p.x, p.y, p.z),
        1 - Math.exp(-12 * dt),
      );
      avatar.rotation.y = p.yaw;
      avatar.visible = p.connected;
    }
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = REACH;
    const hit = this.ray.intersectObjects(this.meshes)[0];
    this.selected =
      hit && hit.instanceId !== undefined
        ? {
            block: hit.object.userData.blocks[hit.instanceId],
            normal: hit.face!.normal.clone(),
          }
        : undefined;
    this.highlight.visible = !!this.selected;
    if (this.selected) {
      const b = this.selected.block;
      this.highlight.position.set(b.x, b.y, b.z);
      this.onTarget(`${b.material} · ${b.x}, ${b.y}, ${b.z}`);
    } else this.onTarget('Aim at a block');
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };
  leaveWorld() {
    this.keys.clear();
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.camera.position.set(0, 6, 8);
    this.camera.lookAt(0, 2, 0);
    this.selected = undefined;
    this.highlight.visible = false;
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('pointerlockchange', this.blur);
    document.removeEventListener('mousemove', this.mousemove);
    this.host.removeEventListener('mousedown', this.mouse);
    this.host.removeEventListener('contextmenu', this.context);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
