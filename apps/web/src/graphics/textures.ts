import * as THREE from 'three';

// Procedural voxel textures: 16x16 noise with a subtle vertical gradient, so
// flat-color blocks read as real material with depth and grain. Textures are
// cached by color and shared across blocks and avatars.
const textureCache = new Map<number, THREE.CanvasTexture>();

export function voxelTextureFor(color: number): THREE.CanvasTexture {
  let texture = textureCache.get(color);
  if (texture) return texture;
  texture = makeTexture(color);
  textureCache.set(color, texture);
  return texture;
}

function makeTexture(color: number): THREE.CanvasTexture {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    // Vertical gradient: brighter on top, darker toward the bottom.
    const gradient = 1.12 - (y / size) * 0.26;
    for (let x = 0; x < size; x++) {
      // Grain: random per-texel brightness for a pixel-art material feel.
      const grain = 0.9 + Math.random() * 0.2;
      const i = (y * size + x) * 4;
      const shade = gradient * grain;
      data[i] = Math.min(255, base.r * 255 * shade);
      data[i + 1] = Math.min(255, base.g * 255 * shade);
      data[i + 2] = Math.min(255, base.b * 255 * shade);
      data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Vertical gradient sky: deep blue at the top fading to a pale horizon. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#64a6df');
  gradient.addColorStop(0.55, '#a4d1ec');
  gradient.addColorStop(1, '#e6f1ec');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ===== Real photo textures (ported from the single-file reference, r128 → 0.180) =====
// Photos live in /public/textures and load asynchronously; materials are created
// immediately with the procedural fallback map, then swap to the photo on arrival
// via `needsUpdate = true` — the InstancedMesh is never rebuilt for textures.

const photoCache = new Map<string, THREE.Texture>();
const photoLoader = new THREE.TextureLoader();

/**
 * Load a /textures/*.jpg photo with sRGB color space, repeat wrapping and
 * trilinear mipmapping (photo realism, sharp at grazing angles via anisotropy).
 * The callback fires immediately for a cached texture and on load otherwise.
 */
export function loadPhotoTexture(
  url: string,
  anisotropy: number,
  onReady: (tex: THREE.Texture) => void,
): THREE.Texture {
  const cached = photoCache.get(url);
  if (cached) {
    onReady(cached);
    return cached;
  }
  const texture = photoLoader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = anisotropy;
    photoCache.set(url, t);
    onReady(t);
  });
  return texture;
}

/** Cover-fit draw (center-crop), matching the reference `drawCover`. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.width,
    ih = img.height;
  const s = Math.max(dw / iw, dh / ih);
  const sw = dw / s,
    sh = dh / s;
  const sx = (iw - sw) / 2,
    sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Grass side tile: grass photo on top, blended into dirt photo below 30%
 * (ramp 30%→45%), ported from the reference post-load grass-side pass.
 */
export function makeGrassSideTexture(
  grassImg: HTMLImageElement,
  dirtImg: HTMLImageElement,
): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  drawCover(ctx, grassImg, 0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, size * 0.3, size, size * 0.7);
  ctx.clip();
  drawCover(ctx, dirtImg, 0, 0, size, size);
  ctx.restore();
  // Per-pixel blend so the dirt fades in smoothly between 30% and 45% height.
  try {
    const side = ctx.getImageData(0, 0, size, size);
    const dirt = ctx.getImageData(0, 0, size, size);
    // Re-render dirt into a second buffer, then composite manually.
    const dirtCanvas = document.createElement('canvas');
    dirtCanvas.width = size;
    dirtCanvas.height = size;
    const dctx = dirtCanvas.getContext('2d')!;
    drawCover(dctx, dirtImg, 0, 0, size, size);
    const dirtData = dctx.getImageData(0, 0, size, size).data;
    for (let y = 0; y < size; y++) {
      const t = y / size;
      if (t <= 0.3) continue;
      const a = Math.min(1, (t - 0.3) / 0.15);
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        side.data[i] = side.data[i]! * (1 - a) + dirtData[i]! * a;
        side.data[i + 1] = side.data[i + 1]! * (1 - a) + dirtData[i + 1]! * a;
        side.data[i + 2] = side.data[i + 2]! * (1 - a) + dirtData[i + 2]! * a;
      }
    }
    ctx.putImageData(side, 0, 0);
  } catch {
    // If canvas access is blocked, the clipped dirt draw already looks acceptable.
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

/** Uncache photo textures (used on full disposal). */
export function disposePhotoTextures() {
  for (const texture of photoCache.values()) texture.dispose();
  photoCache.clear();
}
