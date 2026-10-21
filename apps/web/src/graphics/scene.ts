import * as THREE from 'three';
import { REACH, key, type Block, type Material } from '@voxel/shared';
import { Connection } from '../network/connection';
import { VoxelAvatar } from './avatar';
import {
  blockMaterialBundle,
  heldTextureFor,
  disposeBlockMaterialBundles,
} from './block-materials';
import { disposePhotoTextures } from './textures';
import { CloudField } from './clouds';
import { DayNightCycle } from './daynight';
import { HeldBlock } from './held-block';
import { projectSpeechAnchor } from './speech-anchor';
import { BreakParticles } from './particles';
import { DropField, dropForBreak } from './drops';
import { Foliage } from './foliage';
import { SchoolSign } from './signs';
import { Companion, type CompanionOptions } from './companion';
import { inventory } from '../game/inventory';
import { sfx } from '../game/sounds';
import { craftingUI } from '../game/crafting';
import { drawItemIcon, isPlaceable, type ItemId } from '../game/items';
import { releasePointerLock } from '../utils/pointer-lock';

// Rebuild iterates Object.keys(colors): every server-valid Material must have an
// entry here or blocks of that type never get an InstancedMesh and won't render.
const colors: Record<Material, number> = {
  grass: 0x6b9c52,
  dirt: 0x9c7353,
  stone: 0x8c999b,
  wood: 0xc19766,
  cobble: 0x777777,
  sand: 0xe4d094,
  planks: 0xc4a264,
  leaves: 0x3a7a22,
  brick: 0x9b3c2d,
  workbench: 0x8a6a3a,
  water: 0x3f7fd9,
  snow: 0xf2f7fb,
  ice: 0x9fd4e8,
};
// Shared GPU resources: reused across rebuilds and worlds so block edits never
// recreate geometry/material (the main source of stutter when editing).
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
export class WorldScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 150);
  /**
   * Chunked instancing: one InstancedMesh per (16×16 chunk, material). Only
   * chunks within VIEW_RANGE of the player are visible; farther chunks are
   * unloaded from the scene so the GPU only ever draws the nearby slice of a
   * world that grows without bound (Minecraft-style draw distance).
   */
  static CHUNK = 16;
  static VIEW_RANGE = 3; // ±3 chunks = 48-block render distance
  private meshes = new Map<string, THREE.InstancedMesh>();
  private chunkBlocks = new Map<string, Block[]>();
  private viewCx = Number.NaN;
  private viewCz = Number.NaN;
  private lastVisibilityCheck = 0;
  private avatars = new Map<string, VoxelAvatar>();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.35;
  private last = 0;
  private lastSend = 0;
  private raf = 0;
  private ray = new THREE.Raycaster();
  private highlight: THREE.LineSegments;
  private selected?: { block: Block; normal: THREE.Vector3 };
  private clouds?: CloudField;
  private dayNight?: DayNightCycle;
  private held?: HeldBlock;
  private particles?: BreakParticles;
  private drops?: DropField;
  private foliage?: Foliage;
  private sign?: SchoolSign;
  private companions: Companion[] = [];
  private companionsCreated = false;
  /** UI hook: English line, Chinese translation, and the speaker's name. */
  onCompanionSay?: (en: string, zh: string, name: string) => void;
  private companionTurn = 0;

  /** Have a companion speak a line (used by the oral-practice voice chat). */
  companionReply(en: string, zh: string) {
    if (this.companions.length === 0) return;
    const c = this.companions[this.companionTurn % this.companions.length]!;
    this.companionTurn++;
    c.speak(en, zh);
  }
  private foliageBuilt = false;
  // Optimistic edit confirmations: server broadcast rebuilds the world map; a
  // pending entry resolves once the authoritative map agrees, or rolls back
  // after 1s if the server rejected the edit.
  private pendingBreaks = new Map<
    string,
    { material: Material; at: number }
  >();
  private pendingPlaces = new Map<
    string,
    { material: Material; at: number; consumed: boolean }
  >();
  private heldIcons = new Map<ItemId, THREE.CanvasTexture>();
  private prevSelf = new THREE.Vector3();
  private hasPrevSelf = false;
  material: Material = 'wood';
  onTarget = (text: string) => {};
  // Reused temporaries: avoid per-frame allocation that forces GC hiccups.
  private tmpTarget = new THREE.Vector3();
  private tmpPlayer = new THREE.Vector3();
  private tmpRayOrigin = new THREE.Vector2(0, 0);
  private tmpMatrix = new THREE.Matrix4();
  private tmpColor = new THREE.Color();
  private playerIds = new Set<string>();
  private rebuildTimer?: ReturnType<typeof setTimeout>;
  private rebuildPending = false;
  constructor(
    private host: HTMLDivElement,
    private connection: Connection,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', '3D voxel world');
    host.appendChild(this.renderer.domElement);
    // Day/night cycle owns the background Color and fog color (source 3663-3711).
    this.scene.background = new THREE.Color(0x8ec9ef);
    this.scene.fog = new THREE.Fog(0xcfe2f2, 28, 72);
    const hemi = new THREE.HemisphereLight(0xdff7ff, 0x536339, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffecc6, 3.4);
    sun.position.set(14, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    // 20-minute day/night cycle drives sun arc/intensity, sky and fog color.
    this.dayNight = new DayNightCycle(this.scene, sun, hemi);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x7aaeb6, roughness: 0.5 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.55;
    sea.receiveShadow = true;
    this.scene.add(sea);
    // MC-style flat voxel clouds drifting overhead (source 1994-2012).
    this.clouds = new CloudField(this.scene);
    // Selection outline: black, slightly larger than the block, always visible
    // through geometry (source 2013-2043).
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
      }),
    );
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    // First-person held block lives under the camera; camera must be in scene.
    this.scene.add(this.camera);
    this.held = new HeldBlock(this.camera);
    // Local-only presentation systems (particles, tossed drops, grass/flowers,
    // school sign); block placement/breaking itself stays server-authoritative.
    this.particles = new BreakParticles(this.scene);
    this.drops = new DropField(this.scene);
    this.foliage = new Foliage(this.scene);
    this.sign = new SchoolSign(this.scene);
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
  /** Debounced rebuild: rapid consecutive edits are merged into one pass. */
  scheduleRebuild = () => {
    if (this.rebuildPending) return;
    this.rebuildPending = true;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildPending = false;
      this.rebuild();
    }, 40);
  };
  /** Update instanced data in place; meshes are created once per chunk+material. */
  rebuild = () => {
    // Rebuild the chunk index, then write every chunk's instanced meshes.
    this.chunkBlocks.clear();
    for (const b of this.connection.blocks.values()) {
      const k = `${Math.floor(b.x / WorldScene.CHUNK)},${Math.floor(b.z / WorldScene.CHUNK)}`;
      let arr = this.chunkBlocks.get(k);
      if (!arr) {
        arr = [];
        this.chunkBlocks.set(k, arr);
      }
      arr.push(b);
    }
    for (const [ck, blocks] of this.chunkBlocks) {
      const byMaterial = new Map<Material, Block[]>();
      for (const b of blocks) {
        const arr = byMaterial.get(b.material) ?? [];
        arr.push(b);
        byMaterial.set(b.material, arr);
      }
      for (const [material, arr] of byMaterial) this.writeChunk(ck, material, arr);
    }
    // Drop meshes for chunks that no longer exist (e.g. after edits cleared a chunk).
    const stale: string[] = [];
    for (const key of this.meshes.keys()) {
      const ck = key.slice(0, key.lastIndexOf(':'));
      if (!this.chunkBlocks.has(ck)) stale.push(key);
    }
    for (const key of stale) {
      const mesh = this.meshes.get(key);
      if (mesh) this.scene.remove(mesh);
      this.meshes.delete(key);
    }
    // Resolve optimistic edits against the authoritative block map, then build
    // deterministic foliage once the first snapshot has arrived.
    this.resolvePending();
    if (!this.foliageBuilt && this.connection.blocks.size > 0) {
      this.foliage?.build(this.connection.blocks);
      this.foliageBuilt = true;
    }
    // Keep the school sign seated on the ACTUAL terrain, not the procedural
    // height function, so it never floats after world edits.
    this.sign?.setGround(this.connection.blocks);
    const self = this.connection.self;
    if (self) this.updateVisibility(self.x, self.z);
  };
  /** (Re)build a single chunk-material InstancedMesh from its blocks. */
  private writeChunk(chunkKey: string, material: Material, blocks: Block[]) {
    let mesh = this.meshes.get(chunkKey + ':' + material);
    if (!mesh || blocks.length > mesh.instanceMatrix.count) {
      if (mesh) this.scene.remove(mesh);
      const bundle = blockMaterialBundle(
        material,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      mesh = new THREE.InstancedMesh(
        blockGeometry,
        bundle.material,
        Math.max(blocks.length * 2 + 16, 1024),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.set(chunkKey + ':' + material, mesh);
      this.scene.add(mesh);
      mesh.visible = false; // visibility is (re)applied by updateVisibility
    }
    mesh.count = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      this.tmpMatrix.makeTranslation(b.x, b.y, b.z);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Minecraft leaves look natural with per-block shade variation. Three.js
    // multiplies instanceColor by the material color, so shade around 1.0.
    if (material === 'leaves') {
      if (!mesh.instanceColor) mesh.setColorAt(0, this.tmpColor);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!;
        const shade =
          0.82 +
          (((b.x * 7919 + b.y * 104729 + b.z * 131071) % 997) / 997) * 0.26;
        this.tmpColor.setRGB(shade, shade * 1.02, shade * 0.92);
        mesh.setColorAt(i, this.tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.userData.blocks = blocks;
    mesh.computeBoundingSphere();
  }
  /**
   * Incremental render for streamed terrain: append newly generated blocks to
   * the owning chunk's InstancedMesh instead of rebuilding the whole world, so
   * the frame cost of walking to the edge stays small as the world grows.
   */
  addBlocks = (added: Block[]) => {
    if (added.length === 0) return;
    for (const b of added) {
      const k = `${Math.floor(b.x / WorldScene.CHUNK)},${Math.floor(b.z / WorldScene.CHUNK)}`;
      let arr = this.chunkBlocks.get(k);
      if (!arr) {
        arr = [];
        this.chunkBlocks.set(k, arr);
      }
      arr.push(b);
    }
    const byChunkMaterial = new Map<string, Block[]>();
    for (const b of added) {
      const ck = `${Math.floor(b.x / WorldScene.CHUNK)},${Math.floor(b.z / WorldScene.CHUNK)}`;
      const key = `${ck}:${b.material}`;
      const arr = byChunkMaterial.get(key) ?? [];
      arr.push(b);
      byChunkMaterial.set(key, arr);
    }
    for (const [key, arr] of byChunkMaterial) {
      const sep = key.lastIndexOf(':');
      const ck = key.slice(0, sep);
      const material = key.slice(sep + 1) as Material;
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.count + arr.length > mesh.instanceMatrix.count) {
        // Capacity exhausted (rare): rebuild just this chunk-material.
        const blocks =
          this.chunkBlocks.get(ck)?.filter((b) => b.material === material) ??
          [];
        this.writeChunk(ck, material, blocks);
        continue;
      }
      for (const b of arr) {
        this.tmpMatrix.makeTranslation(b.x, b.y, b.z);
        mesh.setMatrixAt(mesh.count, this.tmpMatrix);
        if (material === 'leaves') {
          const shade =
            0.82 +
            (((b.x * 7919 + b.y * 104729 + b.z * 131071) % 997) / 997) * 0.26;
          this.tmpColor.setRGB(shade, shade * 1.02, shade * 0.92);
          mesh.setColorAt(mesh.count, this.tmpColor);
        }
        mesh.count++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (material === 'leaves' && mesh.instanceColor)
        mesh.instanceColor.needsUpdate = true;
      const prev = mesh.userData.blocks as Block[] | undefined;
      mesh.userData.blocks = prev ? prev.concat(arr) : arr;
      mesh.computeBoundingSphere();
    }
    const self = this.connection.self;
    if (self) this.updateVisibility(self.x, self.z);
  };
  /**
   * Minecraft-style draw distance: show chunks within VIEW_RANGE of the
   * player, hide the rest, and fully unload far chunks (keeps the scene graph
   * and GPU load flat as the world grows).
   */
  private updateVisibility(px: number, pz: number) {
    const pcx = Math.floor(px / WorldScene.CHUNK);
    const pcz = Math.floor(pz / WorldScene.CHUNK);
    if (pcx === this.viewCx && pcz === this.viewCz) return;
    this.viewCx = pcx;
    this.viewCz = pcz;
    const toUnload: string[] = [];
    for (const [key, mesh] of this.meshes) {
      const sep = key.lastIndexOf(':');
      const [cx, cz] = key
        .slice(0, sep)
        .split(',')
        .map(Number) as [number, number];
      const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
      if (dist <= WorldScene.VIEW_RANGE) {
        mesh.visible = true;
      } else {
        mesh.visible = false;
        if (dist > WorldScene.VIEW_RANGE + 1) toUnload.push(key);
      }
    }
    for (const key of toUnload) {
      const mesh = this.meshes.get(key);
      if (mesh) this.scene.remove(mesh);
      this.meshes.delete(key);
    }
  }
  /**
   * Confirm optimistic edits after a server broadcast rebuild: a break is
   * confirmed once the cell is gone (then spawn its drop); a place once the
   * cell exists with the requested material (then play placeBlock). Stale
   * entries are swept in the frame loop after 1s.
   */
  private resolvePending() {
    const blocks = this.connection.blocks;
    for (const [k, entry] of this.pendingBreaks) {
      if (!blocks.has(k)) {
        const [x, y, z] = k.split(',').map(Number);
        const drop = dropForBreak(entry.material);
        if (drop) this.drops?.spawn(x!, y!, z!, drop);
        this.pendingBreaks.delete(k);
      }
    }
    for (const [k, entry] of this.pendingPlaces) {
      const b = blocks.get(k);
      if (b && b.material === entry.material) {
        if (entry.consumed) sfx.placeBlock();
        this.pendingPlaces.delete(k);
      }
    }
  }
  /** Drop unconfirmed optimistic edits after 1s; refund consumed place items. */
  private sweepPending() {
    const now = performance.now();
    for (const [k, entry] of this.pendingPlaces) {
      if (now - entry.at > 1000) {
        if (entry.consumed) inventory.add(entry.material as ItemId, 1);
        this.pendingPlaces.delete(k);
      }
    }
    for (const [k, entry] of this.pendingBreaks) {
      if (now - entry.at > 1000) this.pendingBreaks.delete(k);
    }
  }
  /** 32px pixel icon texture for a non-block held item (cached). */
  private heldIcon(id: ItemId): THREE.CanvasTexture {
    let tex = this.heldIcons.get(id);
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
    this.heldIcons.set(id, tex);
    return tex;
  }
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
    // B: ask the builder companion to raise a house in front of you.
    if (event.code === 'KeyB') {
      for (const c of this.companions) c.requestBuild();
    }
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
    if (!place) {
      // Left click: optimistic break — particles + sound now, drop spawns once
      // the server broadcast confirms the cell is gone (resolvePending).
      if (block.material !== 'water') {
        this.particles?.spawn(
          block.x,
          block.y,
          block.z,
          block.material as ItemId,
        );
        sfx.breakBlock();
      }
      this.pendingBreaks.set(key(block), {
        material: block.material,
        at: performance.now(),
      });
      this.connection.action('edit', {
        x: block.x,
        y: block.y,
        z: block.z,
        material: null,
        revision: this.connection.revision,
      });
      return;
    }
    // Right click: aiming at a workbench opens the 3x3 crafting table instead
    // of placing a block.
    if (block.material === 'workbench') {
      craftingUI.openCrafting(3);
      releasePointerLock();
      sfx.click();
      return;
    }
    const held = inventory.selectedItem();
    let mat: Material | null = null;
    let consume = false;
    if (isPlaceable(held)) {
      mat = held;
      if (!inventory.has(mat, 1)) return;
      consume = true;
    } else if (held == null) {
      // Empty hand: fall back to the footer-selected world material.
      mat = this.material;
    } else {
      // Tool / food in hand: nothing to place.
      return;
    }
    const tx = block.x + normal.x;
    const ty = block.y + normal.y;
    const tz = block.z + normal.z;
    // Optimistic consume; rolled back by add() if the server rejects within 1s.
    // mat only reaches here from the placeable held item, which is an ItemId.
    if (consume && !inventory.consume(mat as ItemId, 1)) return;
    this.pendingPlaces.set(key({ x: tx, y: ty, z: tz }), {
      material: mat,
      at: performance.now(),
      consumed: consume,
    });
    this.connection.action('edit', {
      x: tx,
      y: ty,
      z: tz,
      material: mat,
      revision: this.connection.revision,
    });
  }
  private frame = (time: number) => {
    const dt = Math.min((time - this.last) / 1000, 0.1);
    this.last = time;
    const self = this.connection.self;
    if (self) {
      // Streamed terrain draw distance: refresh visible chunks as the player
      // moves (throttled; updateVisibility no-ops unless the chunk changed).
      if (time - this.lastVisibilityCheck > 300) {
        this.lastVisibilityCheck = time;
        this.updateVisibility(self.x, self.z);
      }
      // Spawn the companion team once we have a world position. Three helpers
      // with distinct roles orbit the player at different angles/distances.
      if (!this.companionsCreated) {
        this.companionsCreated = true;
        const team: CompanionOptions[] = [
          {
            name: 'Steve',
            skin: 'steve',
            role: 'build',
            followDistance: 3.5,
            offsetAngle: Math.PI / 2,
          },
          {
            name: 'Alex',
            skin: 'alex',
            role: 'garden',
            followDistance: 5,
            offsetAngle: Math.PI * 7 / 6,
          },
          {
            name: 'Sam',
            skin: 'sam',
            role: 'talk',
            followDistance: 6.5,
            offsetAngle: Math.PI * 11 / 6,
          },
        ];
        for (const opts of team) {
          const c = new Companion(this.scene, this.connection, opts);
          c.onSay = (en, zh, name) => this.onCompanionSay?.(en, zh, name);
          this.companions.push(c);
        }
      }
      this.tmpTarget.set(self.x, self.y + 1.5, self.z);
      this.camera.position.lerp(this.tmpTarget, 1 - Math.exp(-20 * dt));
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    // Companion team follows the player; builders and gardeners do their work.
    for (const c of this.companions) c.update(dt);
    // Environment: day/night curve, cloud drift, held-block selection and bob.
    this.dayNight?.update(dt);
    this.clouds?.update(dt, this.dayNight?.nightFactor ?? 0);
    let selfSpeed = 0;
    if (self && dt > 0) {
      if (this.hasPrevSelf) {
        selfSpeed = Math.min(
          Math.hypot(self.x - this.prevSelf.x, self.z - this.prevSelf.z) / dt,
          8,
        );
      }
      this.prevSelf.set(self.x, self.y, self.z);
      this.hasPrevSelf = true;
    } else {
      this.hasPrevSelf = false;
    }
    // Held item: inventory selection drives the viewmodel. A selected block
    // shows its bundle texture; a selected tool/food shows its drawItemIcon;
    // an empty hand falls back to the footer-selected world material.
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const held = inventory.selectedItem();
    if (held && isPlaceable(held)) {
      const bundle = blockMaterialBundle(held, anisotropy);
      this.held?.setMaterial(held, bundle.heldTexture);
    } else if (held) {
      this.held?.showTexture(this.heldIcon(held));
    } else {
      blockMaterialBundle(this.material, anisotropy);
      this.held?.setMaterial(this.material, heldTextureFor(this.material));
    }
    this.held?.update(dt, selfSpeed);

    // Local-only presentation: debris particles, tossed drops, pending sweep.
    this.particles?.update(dt);
    this.drops?.update(dt, self, (x, y, z) =>
      this.connection.blocks.has(key({ x, y, z })),
    );
    this.sweepPending();
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
    this.playerIds.clear();
    for (const p of this.connection.players)
      if (p.id !== self?.id) this.playerIds.add(p.id);
    for (const [id, avatar] of this.avatars)
      if (!this.playerIds.has(id)) {
        this.scene.remove(avatar);
        avatar.dispose();
        this.avatars.delete(id);
      }
    for (const p of this.connection.players) {
      if (p.id === self?.id) continue;
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = new VoxelAvatar(p);
        avatar.position.set(p.x, p.y, p.z);
        this.avatars.set(p.id, avatar);
        this.scene.add(avatar);
      }
      const previousX = avatar.position.x,
        previousZ = avatar.position.z;
      this.tmpPlayer.set(p.x, p.y, p.z);
      avatar.position.lerp(this.tmpPlayer, 1 - Math.exp(-12 * dt));
      avatar.animate(
        dt,
        dt > 0
          ? Math.hypot(
              avatar.position.x - previousX,
              avatar.position.z - previousZ,
            ) / dt
          : 0,
      );
      avatar.rotation.y = p.yaw;
      avatar.visible = p.connected;
      avatar.nameplate.update(
        p,
        this.camera.position.distanceTo(avatar.position),
      );
    }
    this.ray.setFromCamera(this.tmpRayOrigin, this.camera);
    this.ray.far = REACH;
    const hit = this.ray.intersectObjects([...this.meshes.values()])[0];
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
  /** Project an actor's screen position for speech-caption anchoring. */
  speechAnchor(actor: string) {
    const avatar = this.avatars.get(actor);
    if (!avatar?.visible || this.connection.status !== 'connected') return null;
    return projectSpeechAnchor(
      this.camera,
      avatar.position,
      this.host.clientWidth,
      this.host.clientHeight,
      Array.from(this.meshes.values()),
    );
  }
  leaveWorld() {
    this.keys.clear();
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.camera.position.set(0, 6, 8);
    this.camera.lookAt(0, 2, 0);
    this.selected = undefined;
    this.highlight.visible = false;
    this.hasPrevSelf = false;
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.rebuildTimer);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('pointerlockchange', this.blur);
    document.removeEventListener('mousemove', this.mousemove);
    this.host.removeEventListener('mousedown', this.mouse);
    this.host.removeEventListener('contextmenu', this.context);
    for (const avatar of this.avatars.values()) {
      this.scene.remove(avatar);
      avatar.dispose();
    }
    this.avatars.clear();
    for (const mesh of this.meshes.values()) this.scene.remove(mesh);
    this.meshes.clear();
    this.held?.dispose();
    this.held = undefined;
    this.particles?.dispose();
    this.particles = undefined;
    this.drops?.dispose();
    this.drops = undefined;
    this.foliage?.dispose();
    this.foliage = undefined;
    this.sign?.dispose();
    this.sign = undefined;
    for (const c of this.companions) c.dispose();
    this.companions = [];
    this.companionsCreated = false;
    this.pendingBreaks.clear();
    this.pendingPlaces.clear();
    for (const tex of this.heldIcons.values()) tex.dispose();
    this.heldIcons.clear();
    this.clouds?.dispose();
    this.clouds = undefined;
    this.dayNight = undefined;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else mat.dispose();
      }
    });
    disposeBlockMaterialBundles();
    disposePhotoTextures();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
