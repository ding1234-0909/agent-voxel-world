import * as THREE from 'three';
import type { Material } from '@voxel/shared';
import {
  voxelTextureFor,
  loadPhotoTexture,
  makeGrassSideTexture,
} from './textures';

// Per-game-material base tint (matches scene.ts legacy palette; only used as
// the fallback color while photos / procedural maps are still swapping in).
const fallbackColor: Record<Material, number> = {
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
};

// Photo assets in /public/textures. wood (log) keeps bark.jpg; workbench has no
// photo and is drawn procedurally below.
const photoFile: Partial<Record<Material, string>> = {
  dirt: 'dirt.jpg',
  stone: 'stone.jpg',
  wood: 'bark.jpg',
  cobble: 'cobble.jpg',
  sand: 'sand.jpg',
  planks: 'planks.jpg',
  leaves: 'leaves.jpg',
  brick: 'brick.jpg',
};

export interface BlockMaterialBundle {
  /**
   * Material(s) handed to the InstancedMesh. Grass and workbench use a 6-entry
   * array matching BoxGeometry groups [+x, -x, +y(top), -y(bottom), +z, -z];
   * the other materials use a single MeshStandardMaterial.
   */
  material: THREE.Material | THREE.Material[];
  /** Texture the first-person held block shows for this game material. */
  heldTexture: THREE.Texture;
}

interface BundleState {
  bundle: BlockMaterialBundle;
  pieces: THREE.MeshStandardMaterial[];
}

// Module-level cache: materials are created once and reused across rebuilds,
// exactly like the legacy blockMaterials map. Photos swap in asynchronously.
const bundleCache = new Map<Material, BundleState>();
// Procedural canvases (workbench) live at module scope so disposal is complete.
const proceduralTextures: THREE.Texture[] = [];

function standard(
  fallback: number,
  map: THREE.Texture | undefined,
  extra?: Partial<THREE.MeshStandardMaterialParameters>,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: map ?? voxelTextureFor(fallback),
    roughness: 0.85,
    metalness: 0,
    ...extra,
  });
}

// ===== Procedural workbench (ported from source tWorkbench, lines 1486-1499) =====
// Top: plank field with a 2x2 crafting grid; sides: wooden frame with a small
// tool motif; bottom: plain planks. 64px pixel-art canvas, NearestFilter.

function canvasTex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  proceduralTextures.push(texture);
  return texture;
}

function workbenchTopCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // Plank base with per-plank shade variation + horizontal grain lines.
  const plankH = 16;
  for (let row = 0; row < 4; row++) {
    g.fillStyle = row % 2 === 0 ? '#b88b4a' : '#a07a3c';
    g.fillRect(0, row * plankH, 64, plankH);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, row * plankH, 64, 2);
    // grain streaks
    g.fillStyle = 'rgba(90,55,20,0.25)';
    for (let i = 0; i < 4; i++)
      g.fillRect(4 + ((row * 13 + i * 17) % 52), row * plankH + 5 + i * 3, 12, 1);
  }
  // 2x2 crafting grid: dark recessed squares on the board center.
  g.fillStyle = '#6e4f24';
  g.fillRect(6, 6, 52, 52);
  const cell = 22;
  for (let ry = 0; ry < 2; ry++)
    for (let rx = 0; rx < 2; rx++) {
      g.fillStyle = '#c99a55';
      g.fillRect(9 + rx * (cell + 4), 9 + ry * (cell + 4), cell, cell);
      g.strokeStyle = 'rgba(60,35,12,0.6)';
      g.strokeRect(9.5 + rx * (cell + 4), 9.5 + ry * (cell + 4), cell, cell);
    }
  return c;
}

function workbenchSideCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // Frame: darker border around a plank panel.
  g.fillStyle = '#8a6230';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#b88b4a';
  g.fillRect(5, 5, 54, 54);
  // inner plank seams
  g.fillStyle = 'rgba(80,50,18,0.35)';
  for (let y = 16; y < 60; y += 14) g.fillRect(5, y, 54, 2);
  // Simple tool motif: a small saw (diagonal handle + teeth) on the panel.
  g.save();
  g.translate(32, 32);
  g.rotate(-0.5);
  g.fillStyle = '#7a7a7a';
  g.fillRect(-16, -3, 26, 6);
  // teeth
  g.fillStyle = '#9a9a9a';
  for (let i = 0; i < 6; i++) g.fillRect(-14 + i * 4, 3, 2, 3);
  g.fillStyle = '#6a4020';
  g.fillRect(8, -4, 10, 8);
  g.restore();
  return c;
}

function workbenchBottomCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a07a3c';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(80,50,18,0.35)';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
  return c;
}

let workbenchBundle: BundleState | null = null;

/**
 * Build (once) the material bundle for a game material, then attach photo
 * textures asynchronously. `onArrive` lets the caller flag a needsUpdate.
 */
export function blockMaterialBundle(
  game: Material,
  anisotropy: number,
  onArrive?: () => void,
): BlockMaterialBundle {
  const cached = bundleCache.get(game);
  if (cached) return cached.bundle;

  const pieces: THREE.MeshStandardMaterial[] = [];
  let bundle: BlockMaterialBundle;

  if (game === 'grass') {
    const top = standard(fallbackColor.grass, undefined);
    const side = standard(fallbackColor.grass, undefined);
    const bottom = standard(fallbackColor.dirt, undefined);
    pieces.push(side, side, top, bottom, side, side);
    bundle = {
      material: pieces,
      heldTexture: top.map!,
    };
    // grass top photo
    loadPhotoTexture('/textures/grass.jpg', anisotropy, (t) => {
      top.map = t;
      top.needsUpdate = true;
      bundle.heldTexture = t;
      onArrive?.();
    });
    // grass side: grass blended into dirt (needs both photos)
    let grassImg: HTMLImageElement | undefined;
    let dirtImg: HTMLImageElement | undefined;
    const tryComposite = () => {
      if (!grassImg || !dirtImg) return;
      const sideTex = makeGrassSideTexture(grassImg, dirtImg);
      side.map = sideTex;
      side.needsUpdate = true;
      onArrive?.();
    };
    loadPhotoTexture('/textures/grass.jpg', anisotropy, (t) => {
      grassImg = t.image as HTMLImageElement;
      tryComposite();
    });
    loadPhotoTexture('/textures/dirt.jpg', anisotropy, (t) => {
      dirtImg = t.image as HTMLImageElement;
      bottom.map = t;
      bottom.needsUpdate = true;
      tryComposite();
    });
  } else if (game === 'workbench') {
    if (workbenchBundle) {
      bundleCache.set(game, workbenchBundle);
      return workbenchBundle.bundle;
    }
    const top = standard(fallbackColor.workbench, canvasTex(workbenchTopCanvas()));
    const side = standard(fallbackColor.workbench, canvasTex(workbenchSideCanvas()));
    const bottom = standard(
      fallbackColor.planks,
      canvasTex(workbenchBottomCanvas()),
    );
    pieces.push(side, side, top, bottom, side, side);
    bundle = { material: pieces, heldTexture: top.map! };
    workbenchBundle = { bundle, pieces };
  } else {
    // Leaves: softer, semi-transparent, fully rough (source tLeaves).
    // Water: translucent, write nothing to depth so the lake reads as shallow.
    const isLeaves = game === 'leaves';
    const isWater = game === 'water';
    const mat = standard(
      fallbackColor[game],
      undefined,
      isLeaves
        ? { transparent: true, opacity: 0.95, roughness: 1 }
        : isWater
          ? { transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.6 }
          : undefined,
    );
    pieces.push(mat);
    bundle = { material: mat, heldTexture: mat.map! };
    const file = photoFile[game];
    if (file) {
      loadPhotoTexture(`/textures/${file}`, anisotropy, (t) => {
        mat.map = t;
        mat.needsUpdate = true;
        bundle.heldTexture = t;
        onArrive?.();
      });
    }
  }

  bundleCache.set(game, { bundle, pieces });
  return bundle;
}

/** Refresh the held-block texture reference after photos arrive. */
export function heldTextureFor(game: Material): THREE.Texture | undefined {
  return bundleCache.get(game)?.bundle.heldTexture;
}

/** Dispose cached bundle materials (full scene teardown). */
export function disposeBlockMaterialBundles() {
  for (const state of bundleCache.values()) {
    for (const piece of state.pieces) piece.dispose();
  }
  bundleCache.clear();
  for (const texture of proceduralTextures) texture.dispose();
  proceduralTextures.length = 0;
  workbenchBundle = null;
}
