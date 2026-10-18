import * as THREE from 'three';

// ============================================================================
// Minecraft 像素皮肤生成（移植自 AI 小学版"像素皮肤纹理生成"模块）。
// 用 64x64 CanvasTexture 程序化画出经典 Steve/Alex 皮肤各面，NearestFilter
// 保持像素感。所有纹理按配色缓存共享，多人进入不重复生成。
// 面顺序（BoxGeometry 材质数组）: right, left, top, bottom, front, back
// ============================================================================

export interface SkinPalette {
  skin: string;
  skinD: string;
  skinL: string;
  hair: string;
  hairD: string;
  hairL: string;
  shirt: string;
  shirtD: string;
  shirtL: string;
  pants: string;
  pantsD: string;
  pantsL: string;
  shoe: string;
  shoeD: string;
  /** Steve has a beard, Alex does not. */
  beard: boolean;
}

/** Classic Steve: teal shirt, blue pants, brown hair, beard. */
export const STEVE_PALETTE: SkinPalette = {
  skin: '#c68e58',
  skinD: '#a8743f',
  skinL: '#d8a878',
  hair: '#3b2a1e',
  hairD: '#2a1c14',
  hairL: '#5a4a38',
  shirt: '#00a7a7',
  shirtD: '#008383',
  shirtL: '#00c4c4',
  pants: '#3d3d8f',
  pantsD: '#2e2e6e',
  pantsL: '#5a5ab0',
  shoe: '#4a4a4a',
  shoeD: '#333333',
  beard: true,
};

/** Classic Alex: orange top, grey-green pants, ginger hair, no beard. */
export const ALEX_PALETTE: SkinPalette = {
  skin: '#e6b28a',
  skinD: '#c28f63',
  skinL: '#f2ccaa',
  hair: '#d97a32',
  hairD: '#b05c20',
  hairL: '#f0a35e',
  shirt: '#e07b39',
  shirtD: '#b85f26',
  shirtL: '#f09555',
  pants: '#4a5a6b',
  pantsD: '#36424f',
  pantsL: '#60707f',
  shoe: '#5c5146',
  shoeD: '#3f3a33',
  beard: false,
};

/** Sam: red shirt, dark pants, dark hair, no beard — third companion. */
export const SAM_PALETTE: SkinPalette = {
  skin: '#d9a06b',
  skinD: '#b57e48',
  skinL: '#ecc39a',
  hair: '#241a14',
  hairD: '#140d08',
  hairL: '#3a2c20',
  shirt: '#c8433a',
  shirtD: '#a23029',
  shirtL: '#e05a50',
  pants: '#33404d',
  pantsD: '#232d38',
  pantsL: '#46586a',
  shoe: '#3a3a3a',
  shoeD: '#272727',
  beard: false,
};

function pxTex(
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 64,
  h = 64,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  drawFn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function skinMat(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0,
  });
}

export interface SkinBundle {
  head: THREE.Material[];
  body: THREE.Material[];
  arm: THREE.Material[];
  leg: THREE.Material[];
  shoe: THREE.Material[];
}

const skinCache = new Map<SkinPalette, SkinBundle>();

function makeSkinTextures(p: SkinPalette): SkinBundle {
  const headFrontTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    // Hair (top + sides)
    ctx.fillStyle = p.hair;
    ctx.fillRect(0, 0, 64, 20);
    ctx.fillRect(0, 0, 8, 32);
    ctx.fillRect(56, 0, 8, 32);
    // Fringe layers
    ctx.fillStyle = p.hairL;
    ctx.fillRect(8, 8, 16, 8);
    ctx.fillRect(40, 8, 16, 8);
    ctx.fillStyle = p.hair;
    ctx.fillRect(12, 4, 12, 6);
    ctx.fillRect(40, 4, 12, 6);
    // Ears
    ctx.fillStyle = p.skinD;
    ctx.fillRect(0, 32, 4, 12);
    ctx.fillRect(60, 32, 4, 12);
    // Eyebrows
    ctx.fillStyle = p.hair;
    ctx.fillRect(12, 24, 12, 4);
    ctx.fillRect(40, 24, 12, 4);
    // Eye whites
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, 28, 14, 10);
    ctx.fillRect(38, 28, 14, 10);
    // Pupils (blue)
    ctx.fillStyle = '#3f76e4';
    ctx.fillRect(17, 28, 8, 10);
    ctx.fillRect(43, 28, 8, 10);
    ctx.fillStyle = '#2a5ac0';
    ctx.fillRect(20, 30, 3, 6);
    ctx.fillRect(46, 30, 3, 6);
    // Pupil highlights
    ctx.fillStyle = '#cfe0ff';
    ctx.fillRect(18, 29, 2, 3);
    ctx.fillRect(44, 29, 2, 3);
    // Nose
    ctx.fillStyle = p.skinD;
    ctx.fillRect(28, 36, 8, 8);
    ctx.fillStyle = p.skinL;
    ctx.fillRect(28, 36, 2, 8);
    // Beard (classic Steve)
    if (p.beard) {
      ctx.fillStyle = p.hair;
      ctx.fillRect(16, 44, 8, 8);
      ctx.fillRect(40, 44, 8, 8);
      ctx.fillRect(24, 48, 16, 8);
    }
    // Mouth
    ctx.fillStyle = '#7a4a3a';
    ctx.fillRect(24, 56, 16, 4);
  });
  const headBackTex = pxTex((ctx) => {
    ctx.fillStyle = p.hair;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.hairD;
    ctx.fillRect(8, 44, 48, 12);
    ctx.fillStyle = p.hairL;
    ctx.fillRect(16, 8, 32, 12);
  });
  const headSideTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.hair;
    ctx.fillRect(0, 0, 64, 20);
    ctx.fillRect(0, 0, 16, 32);
    ctx.fillStyle = p.hairL;
    ctx.fillRect(16, 8, 20, 8);
    // Ear
    ctx.fillStyle = p.skinD;
    ctx.fillRect(48, 32, 10, 10);
    ctx.fillStyle = p.skin;
    ctx.fillRect(52, 34, 4, 6);
  });
  const headTopTex = pxTex((ctx) => {
    ctx.fillStyle = p.hair;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.hairL;
    ctx.fillRect(16, 16, 32, 32);
    ctx.fillStyle = p.hair;
    ctx.fillRect(24, 24, 16, 16);
  });
  const headBottomTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.skinD;
    ctx.fillRect(16, 16, 32, 32);
  });
  const bodyFrontTex = pxTex((ctx) => {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 64);
    // V-neck
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(20, 0, 24, 10);
    ctx.fillRect(16, 4, 32, 6);
    ctx.fillStyle = p.shirtL;
    ctx.fillRect(24, 2, 16, 4);
    // Chest details
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(8, 20, 8, 28);
    ctx.fillRect(48, 20, 8, 28);
    ctx.fillStyle = p.shirtL;
    ctx.fillRect(4, 24, 4, 20);
    ctx.fillRect(56, 24, 4, 20);
    // Hem
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 56, 64, 8);
  });
  const bodyBackTex = pxTex((ctx) => {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 56, 64, 8);
  });
  const bodySideTex = pxTex((ctx) => {
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 56, 64, 8);
    ctx.fillStyle = p.shirtL;
    ctx.fillRect(0, 16, 8, 32);
  });
  const armFrontTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 20);
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 14, 64, 6);
    ctx.fillStyle = p.skinD;
    ctx.fillRect(48, 20, 16, 12);
  });
  const armBackTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 20);
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 14, 64, 6);
  });
  const armSideTex = pxTex((ctx) => {
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shirt;
    ctx.fillRect(0, 0, 64, 20);
    ctx.fillStyle = p.shirtD;
    ctx.fillRect(0, 14, 64, 6);
    ctx.fillStyle = p.skinD;
    ctx.fillRect(0, 40, 64, 24);
  });
  const legFrontTex = pxTex((ctx) => {
    ctx.fillStyle = p.pants;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.pantsD;
    ctx.fillRect(0, 52, 64, 12);
    ctx.fillStyle = p.pantsL;
    ctx.fillRect(8, 8, 8, 44);
    ctx.fillStyle = p.pantsD;
    ctx.fillRect(24, 28, 4, 24);
  });
  const legBackTex = pxTex((ctx) => {
    ctx.fillStyle = p.pants;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.pantsD;
    ctx.fillRect(0, 52, 64, 12);
    ctx.fillStyle = p.pantsD;
    ctx.fillRect(32, 28, 4, 24);
  });
  const legSideTex = pxTex((ctx) => {
    ctx.fillStyle = p.pants;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.pantsD;
    ctx.fillRect(0, 52, 64, 12);
    ctx.fillStyle = p.pantsL;
    ctx.fillRect(0, 8, 8, 44);
  });
  const shoeTex = pxTex((ctx) => {
    ctx.fillStyle = p.shoe;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = p.shoeD;
    ctx.fillRect(0, 44, 64, 20);
    ctx.fillStyle = p.shoeD;
    ctx.fillRect(0, 0, 16, 64);
  });

  const head = [headSideTex, headSideTex, headTopTex, headBottomTex, headFrontTex, headBackTex];
  const body = [bodySideTex, bodySideTex, bodyFrontTex, bodyFrontTex, bodyFrontTex, bodyBackTex];
  const arm = [armSideTex, armSideTex, armFrontTex, armFrontTex, armFrontTex, armBackTex];
  const leg = [legSideTex, legSideTex, legFrontTex, legFrontTex, legFrontTex, legBackTex];
  const shoe = [shoeTex, shoeTex, shoeTex, shoeTex, shoeTex, shoeTex];

  return {
    head: head.map((t) => skinMat(t)),
    body: body.map((t) => skinMat(t)),
    arm: arm.map((t) => skinMat(t)),
    leg: leg.map((t) => skinMat(t)),
    shoe: shoe.map((t) => skinMat(t)),
  };
}

/** Get (and cache) a full skin material bundle for a palette. */
export function skinBundleFor(palette: SkinPalette): SkinBundle {
  let bundle = skinCache.get(palette);
  if (!bundle) {
    bundle = makeSkinTextures(palette);
    skinCache.set(palette, bundle);
  }
  return bundle;
}

export function disposeSkinBundles() {
  for (const bundle of skinCache.values()) {
    for (const mats of [bundle.head, bundle.body, bundle.arm, bundle.leg, bundle.shoe]) {
      for (const m of mats) {
        m.dispose();
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
      }
    }
  }
  skinCache.clear();
}
