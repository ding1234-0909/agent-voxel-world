// ============================================================================
// 物品 / 方块定义（移植自 AI 小学版源码 1235-1260、2956-3080 行）
// 这是整个客户端共用的唯一物品契约：背包/合成（UI）、手持方块与掉落物（3D）
// 都从这里取定义。新增方块时必须同步 packages/shared 的 Material 联合类型、
// 服务端 bailian.ts 枚举、graphics/block-materials.ts 的纹理映射。
// ============================================================================

/**
 * 可放置的方块 id。前 4 种（grass/dirt/stone/wood）与 packages/shared 的
 * Material 相同；扩展的 6 种需要在 Material 联合类型中补齐（阶段二 3D 组负责）。
 */
export type BlockId =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'cobble'
  | 'sand'
  | 'planks'
  | 'leaves'
  | 'brick'
  | 'workbench';

export type ItemId =
  | BlockId
  | 'stick'
  | 'torch'
  | 'coal'
  | 'wood_pick'
  | 'stone_pick'
  | 'wood_axe'
  | 'stone_axe'
  | 'wood_sword'
  | 'stone_sword'
  | 'apple'
  | 'bread';

export type ItemKind = 'block' | 'tool' | 'food' | 'item';

export interface ItemDef {
  id: ItemId;
  /** 中文名，用于背包/合成悬浮提示 */
  name: string;
  kind: ItemKind;
  /** 最大堆叠数量 */
  maxStack: number;
  /** 主色（无照片贴图时的图标/粒子/掉落物颜色），十六进制数字 */
  color: number;
}

export const BLOCK_IDS: BlockId[] = [
  'grass',
  'dirt',
  'stone',
  'wood',
  'cobble',
  'sand',
  'planks',
  'leaves',
  'brick',
  'workbench',
];

/** 该 id 是否可放置到世界（对应源码 PLACEABLE） */
export const isPlaceable = (id: ItemId | null | undefined): id is BlockId =>
  !!id && (BLOCK_IDS as string[]).includes(id);

const block = (
  id: BlockId,
  name: string,
  color: number,
): ItemDef => ({ id, name, kind: 'block', maxStack: 64, color });

const tool = (id: ItemId, name: string): ItemDef => ({
  id,
  name,
  kind: 'tool',
  maxStack: 1,
  color: 0x8b5a2b,
});

const food = (id: ItemId, name: string, color: number): ItemDef => ({
  id,
  name,
  kind: 'food',
  maxStack: 16,
  color,
});

export const ITEMS: Record<ItemId, ItemDef> = {
  // 方块
  grass: block('grass', '草方块', 0x6b9c52),
  dirt: block('dirt', '泥土', 0x9c7353),
  stone: block('stone', '石头', 0x8c999b),
  wood: block('wood', '原木', 0x6a4a24),
  cobble: block('cobble', '圆石', 0x777777),
  sand: block('sand', '沙子', 0xe4d094),
  planks: block('planks', '木板', 0xc4a264),
  leaves: block('leaves', '树叶', 0x3a7a22),
  brick: block('brick', '红砖', 0x9b3c2d),
  workbench: block('workbench', '工作台', 0x8a6a3a),
  // 材料 / 工具 / 食物
  stick: { id: 'stick', name: '木棍', kind: 'item', maxStack: 64, color: 0x8b5a2b },
  torch: { id: 'torch', name: '火把', kind: 'item', maxStack: 64, color: 0xffcc00 },
  coal: { id: 'coal', name: '煤炭', kind: 'item', maxStack: 64, color: 0x222222 },
  wood_pick: tool('wood_pick', '木镐'),
  stone_pick: tool('stone_pick', '石镐'),
  wood_axe: tool('wood_axe', '木斧'),
  stone_axe: tool('stone_axe', '石斧'),
  wood_sword: tool('wood_sword', '木剑'),
  stone_sword: tool('stone_sword', '石剑'),
  apple: food('apple', '苹果', 0xd04a3a),
  bread: food('bread', '面包', 0xc89b5a),
};

/** 进世界快捷栏（对应源码 HOTBAR；原第 8 格为玻璃，本项目无玻璃资产，用沙子） */
export const HOTBAR: ItemId[] = [
  'grass',
  'dirt',
  'stone',
  'cobble',
  'wood',
  'planks',
  'leaves',
  'sand',
  'brick',
];

// ---------------------------------------------------------------------------
// 配方（移植自源码 3030-3057 行；0/空 = 空槽；只保留本项目可获得物品的配方）
// 2x2 = 随身合成；3x3 = 工作台。
// ---------------------------------------------------------------------------
export interface Recipe {
  size: 2 | 3;
  pattern: (ItemId | 0)[][];
  result: ItemId;
  count: number;
}

const W = 'wood',
  P = 'planks',
  C = 'cobble',
  S = 'stick',
  CO = 'coal';
const T = 'torch';

export const RECIPES: Recipe[] = [
  // 2x2
  { size: 2, pattern: [[W, 0], [0, 0]], result: 'planks', count: 4 },
  { size: 2, pattern: [[P, 0], [P, 0]], result: 'stick', count: 4 },
  { size: 2, pattern: [[P, P], [P, P]], result: 'workbench', count: 1 },
  { size: 2, pattern: [[CO, 0], [S, 0]], result: 'torch', count: 4 },
  { size: 2, pattern: [[C, C], [C, C]], result: 'stone', count: 4 },
  // 3x3 工具
  { size: 3, pattern: [[P, P, P], [0, S, 0], [0, S, 0]], result: 'wood_pick', count: 1 },
  { size: 3, pattern: [[C, C, C], [0, S, 0], [0, S, 0]], result: 'stone_pick', count: 1 },
  { size: 3, pattern: [[P, P, 0], [P, S, 0], [0, S, 0]], result: 'wood_axe', count: 1 },
  { size: 3, pattern: [[C, C, 0], [C, S, 0], [0, S, 0]], result: 'stone_axe', count: 1 },
  { size: 3, pattern: [[0, P, 0], [0, P, 0], [0, S, 0]], result: 'wood_sword', count: 1 },
  { size: 3, pattern: [[0, C, 0], [0, C, 0], [0, S, 0]], result: 'stone_sword', count: 1 },
  { size: 3, pattern: [[C, C, C], [C, 0, C], [C, C, C]], result: 'stone', count: 8 },
  { size: 3, pattern: [[P, P, P], [P, 0, P], [P, P, P]], result: 'planks', count: 4 },
];

/** 对 2x2/3x3 网格做精确匹配（不做形变裁剪，与源码 matchRecipe 一致） */
export function matchRecipe(
  slots: (ItemId | 0)[],
  size: 2 | 3,
): Recipe | null {
  for (const recipe of RECIPES) {
    if (recipe.size !== size) continue;
    let ok = true;
    for (let y = 0; y < size && ok; y++) {
      for (let x = 0; x < size && ok; x++) {
        if ((slots[y * size + x] ?? 0) !== recipe.pattern[y]![x]) ok = false;
      }
    }
    if (ok) return recipe;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 物品图标绘制：方块用真实照片纹理画成 Minecraft 式等轴立方体（顶面亮、
// 左面中、右面暗），非方块物品用 canvas 像素画。UI 与手持物品共用。
// ---------------------------------------------------------------------------
// Photo texture per block id (same assets the 3D world uses). workbench has no
// photo and keeps the simple cube.
const BLOCK_TEXTURE_FILE: Partial<Record<ItemId, string>> = {
  grass: '/textures/grass.jpg',
  dirt: '/textures/dirt.jpg',
  stone: '/textures/stone.jpg',
  wood: '/textures/bark.jpg',
  cobble: '/textures/cobble.jpg',
  sand: '/textures/sand.jpg',
  planks: '/textures/planks.jpg',
  leaves: '/textures/leaves.jpg',
  brick: '/textures/brick.jpg',
};
const textureCache = new Map<string, HTMLImageElement>();

function loadBlockTexture(
  url: string,
  cb: (img: HTMLImageElement) => void,
): void {
  const cached = textureCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    cb(cached);
    return;
  }
  const img = new Image();
  img.onload = () => {
    textureCache.set(url, img);
    cb(img);
  };
  img.src = url;
}

/** Fill a polygon face with the block texture, darkened by `dark` (0..1). */
function fillTexturedFace(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: number[],
  img: HTMLImageElement,
  dark: number,
): void {
  g.save();
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.clip();
  g.fillStyle = g.createPattern(img, 'repeat') ?? '#888';
  g.fillRect(0, 0, w, h);
  if (dark > 0) {
    g.fillStyle = `rgba(0,0,0,${dark})`;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}

/** Minecraft-style isometric block icon from its photo texture. */
function drawTexturedBlock(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement,
): void {
  const cx = w / 2;
  const d = w * 0.375; // horizontal half-width of the cube
  const topY = h * 0.18; // top diamond's top point
  const botY = h * 0.82; // top diamond's bottom point (= side tops)
  // Wide, flat top diamond plus two visible side faces — reads as a cube.
  const top = [cx, topY, cx + d, h / 2, cx, botY, cx - d, h / 2];
  const left = [cx - d, h / 2, cx, botY, cx, h, cx - d, h * 0.72];
  const right = [cx + d, h / 2, cx, botY, cx, h, cx + d, h * 0.72];
  fillTexturedFace(g, w, h, top, img, 0);
  fillTexturedFace(g, w, h, left, img, 0.22);
  fillTexturedFace(g, w, h, right, img, 0.4);
}

/** Simple shaded cube (fallback for blocks without a photo texture). */
function drawSimpleCube(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: number,
): void {
  const r = (color >> 16) & 255,
    gg = (color >> 8) & 255,
    b = color & 255;
  g.fillStyle = `rgb(${Math.round(r * 0.7)},${Math.round(gg * 0.7)},${Math.round(
    b * 0.7,
  )})`;
  g.fillRect(0, 0, w, h);
  g.fillStyle = `rgb(${r},${gg},${b})`;
  g.fillRect(2, 2, w - 4, h - 4);
  g.fillStyle = `rgb(${Math.min(255, r + 24)},${Math.min(255, gg + 24)},${Math.min(
    255,
    b + 24,
  )})`;
  g.fillRect(2, 2, w - 4, Math.floor(h * 0.32));
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
}

export function drawItemIcon(canvas: HTMLCanvasElement, id: ItemId | 0): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  if (id === 0) return;
  const w = canvas.width,
    h = canvas.height;
  const def = ITEMS[id];
  if (def.kind === 'block') {
    const file = BLOCK_TEXTURE_FILE[id];
    if (file) {
      // Draw the textured isometric cube as soon as the photo arrives.
      loadBlockTexture(file, (img) => {
        drawTexturedBlock(g, w, h, img);
      });
      return;
    }
    drawSimpleCube(g, w, h, def.color);
    return;
  }
  switch (id) {
    case 'stick':
      g.fillStyle = '#8b5a2b';
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-0.5);
      g.fillRect(-3, -h / 2 + 4, 6, h - 8);
      g.restore();
      g.fillStyle = '#6a4020';
      g.fillRect(w / 2 - 2, 4, 2, h - 8);
      break;
    case 'torch':
      g.fillStyle = '#8b5a2b';
      g.fillRect(w / 2 - 2, h / 2, 4, h / 2 - 3);
      g.fillStyle = '#ffcc00';
      g.beginPath();
      g.arc(w / 2, h / 2 - 2, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff6600';
      g.beginPath();
      g.arc(w / 2, h / 2 - 1, 3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'coal':
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(w / 2, h / 2, w / 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#444';
      g.beginPath();
      g.arc(w / 2 - 2, h / 2 - 2, w / 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'wood_pick':
    case 'stone_pick': {
      const hc = id === 'wood_pick' ? '#8b5a2b' : '#777';
      g.fillStyle = '#8b5a2b';
      g.save();
      g.translate(w / 2, h / 2 + 4);
      g.rotate(0.6);
      g.fillRect(-2, -h / 3, 4, h / 2);
      g.restore();
      g.fillStyle = hc;
      g.fillRect(w / 2 - 9, h / 2 - 10, 18, 5);
      g.fillRect(w / 2 - 7, h / 2 - 13, 4, 3);
      g.fillRect(w / 2 + 3, h / 2 - 13, 4, 3);
      break;
    }
    case 'wood_axe':
    case 'stone_axe': {
      const ac = id === 'wood_axe' ? '#8b5a2b' : '#777';
      g.fillStyle = '#8b5a2b';
      g.save();
      g.translate(w / 2, h / 2 + 4);
      g.rotate(0.5);
      g.fillRect(-2, -h / 3, 4, h / 2);
      g.restore();
      g.fillStyle = ac;
      g.fillRect(w / 2 - 8, h / 2 - 11, 10, 8);
      g.fillRect(w / 2 - 6, h / 2 - 13, 6, 3);
      break;
    }
    case 'wood_sword':
    case 'stone_sword': {
      const sc = id === 'wood_sword' ? '#c8a868' : '#bbb';
      g.fillStyle = '#8b5a2b';
      g.fillRect(w / 2 - 2, h / 2 + 4, 4, h / 3);
      g.fillStyle = sc;
      g.beginPath();
      g.moveTo(w / 2, h / 2 - 12);
      g.lineTo(w / 2 + 4, h / 2 + 4);
      g.lineTo(w / 2 - 4, h / 2 + 4);
      g.fill();
      g.fillStyle = '#666';
      g.fillRect(w / 2 - 6, h / 2 + 2, 12, 3);
      break;
    }
    case 'apple':
      g.fillStyle = '#d04a3a';
      g.beginPath();
      g.arc(w / 2, h / 2 + 2, w / 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a7a22';
      g.fillRect(w / 2 - 1, h / 2 - h / 3, 2, h / 6);
      break;
    case 'bread':
      g.fillStyle = '#c89b5a';
      g.beginPath();
      g.ellipse(w / 2, h / 2, w / 3, h / 4, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8a6a3a';
      g.beginPath();
      g.moveTo(w / 2 - 8, h / 2);
      g.lineTo(w / 2 + 8, h / 2);
      g.stroke();
      break;
  }
}
