import * as THREE from 'three';
import { height, key, type Block } from '@voxel/shared';

// ============================================================================
// 校牌 / 标牌（移植自源码 1960-1993 makeTextTex / makeSign / makeSigns）。
// 出生点附近一块 MC 风格木牌：立柱 + 横牌 + CanvasTexture 中文牌面。仅本地
// 装饰，不参与多人同步。
// ============================================================================

function makeTextTex(text: string, sub: string | null, fs: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a4a22';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, i * 16 + 8);
    g.lineTo(256, i * 16 + 8);
    g.stroke();
  }
  g.fillStyle = '#3d2410';
  g.fillRect(0, 0, 256, 6);
  g.fillRect(0, 122, 256, 6);
  g.fillRect(0, 0, 6, 128);
  g.fillRect(250, 0, 6, 128);
  g.fillStyle = '#ffe98a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowOffsetY = 3;
  g.shadowBlur = 4;
  g.fillText(text, 128, sub ? 46 : 64);
  g.shadowBlur = 0;
  if (sub) {
    g.fillStyle = '#f3efe6';
    g.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(sub, 128, 96);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSideTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a6230';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(60,35,12,0.35)';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SchoolSign {
  private group = new THREE.Group();
  private textures: THREE.Texture[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private readonly gx = 0;
  private readonly gz = -5;
  /** World y of the post bottoms as built (provisional terrain). */
  private readonly baseY: number;

  constructor(private scene: THREE.Scene) {
    const groundY = height(this.gx, this.gz) + 1; // provisional; corrected below
    this.baseY = groundY;
    const sideTex = makeSideTex();
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 });
    const frontMat = new THREE.MeshStandardMaterial({
      map: makeTextTex('AI小学', 'AI ELEMENTARY SCHOOL', 56),
      roughness: 0.9,
    });
    this.textures.push(sideTex, frontMat.map!);
    this.materials.push(sideMat, frontMat);

    // Posts
    const postGeo = new THREE.BoxGeometry(0.22, 2.0, 0.22);
    this.geometries.push(postGeo);
    for (const px of [-1.5, 1.5]) {
      const post = new THREE.Mesh(postGeo, sideMat);
      post.position.set(this.gx + px, groundY + 1.0, this.gz);
      post.castShadow = true;
      this.group.add(post);
    }

    // Board: BoxGeometry groups [+x,-x,+y,-y,+z(front),-z]
    const boardGeo = new THREE.BoxGeometry(4, 1.3, 0.22);
    this.geometries.push(boardGeo);
    const board = new THREE.Mesh(boardGeo, [
      sideMat,
      sideMat,
      sideMat,
      sideMat,
      frontMat,
      sideMat,
    ]);
    board.position.set(this.gx, groundY + 2.2, this.gz);
    board.castShadow = true;
    this.group.add(board);

    scene.add(this.group);
  }

  /**
   * Re-seat the sign on the ACTUAL block map (not the procedural height
   * function): the post bottoms sit on the top surface of the highest block
   * at the sign's cell, so it never floats after edits change the terrain.
   */
  setGround(blocks: Map<string, Block>) {
    let top = -100;
    for (let y = 0; y <= 24; y++) {
      if (blocks.has(key({ x: this.gx, y, z: this.gz }))) top = y;
    }
    if (top === -100) return; // no terrain here yet; keep provisional spot
    // Post bottoms were built at world y = baseY. Shift the whole group so
    // they now sit exactly on the real surface (top).
    this.group.position.y = top - this.baseY;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
  }
}
