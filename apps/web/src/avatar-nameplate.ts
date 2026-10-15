import * as THREE from 'three';
import type { Player } from '@voxel/shared';

/** A camera-facing label that still respects walls and terrain depth. */
export class AvatarNameplate extends THREE.Sprite {
  private canvas = document.createElement('canvas');
  private texture = new THREE.CanvasTexture(this.canvas);
  private identity = '';
  private aspect = 1;

  constructor() {
    super(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.material.toneMapped = false;
    this.position.y = 2.18;
  }

  update(player: Pick<Player, 'name' | 'kind'>, distance: number) {
    const identity = JSON.stringify([player.name, player.kind]);
    if (identity !== this.identity) {
      this.identity = identity;
      this.draw(player);
    }
    // Keep close names compact, then fade out before they clutter the horizon.
    const height = 0.28 * THREE.MathUtils.clamp(distance / 5, 0.4, 2);
    this.scale.set(height * this.aspect, height, 1);
    this.material.opacity = THREE.MathUtils.clamp((18 - distance) / 6, 0, 1);
    this.visible = this.material.opacity > 0;
  }

  private draw(player: Pick<Player, 'name' | 'kind'>) {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const agent =
      player.kind === 'ai-agent' || player.kind === 'scripted-agent';
    const badge = agent ? 'Agent' : '玩家';
    const font = '600 16px system-ui, sans-serif';
    context.font = font;
    let name = player.name.trim() || (agent ? 'Agent' : '玩家');
    const characters = Array.from(name);
    while (context.measureText(name).width > 180 && characters.length > 1) {
      characters.pop();
      name = `${characters.join('')}…`;
    }
    const nameWidth = Math.ceil(context.measureText(name).width);
    const badgeWidth = agent ? 42 : 34;
    const width = nameWidth + badgeWidth + 34;
    const height = 36;
    this.canvas.width = width * 2;
    this.canvas.height = height * 2;
    context.scale(2, 2);
    context.fillStyle = 'rgba(35, 57, 48, 0.9)';
    context.beginPath();
    context.roundRect(0, 0, width, height, 8);
    context.fill();
    context.strokeStyle = 'rgba(239, 246, 223, 0.28)';
    context.lineWidth = 1;
    context.stroke();
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = '#f4f6e9';
    context.fillText(name, 12, 18);
    context.fillStyle = agent ? '#e5ba71' : '#b7d5bb';
    context.beginPath();
    context.roundRect(nameWidth + 21, 8, badgeWidth, 20, 4);
    context.fill();
    context.font = '600 11px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = '#304b3e';
    context.fillText(badge, nameWidth + 21 + badgeWidth / 2, 18);
    this.aspect = width / height;
    // A renamed label can have new dimensions; replace its GPU allocation.
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}
