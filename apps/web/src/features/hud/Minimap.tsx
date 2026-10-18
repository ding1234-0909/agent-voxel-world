import { useEffect, useRef } from 'react';
import { LIMIT, type Material, type Player } from '@voxel/shared';
import type { Connection } from '../../network/connection';

/**
 * 俯视小地图（参考原版 index.html 第 3552-3638 行 updateMinimap / mmColor）。
 * 原版以玩家为中心旋转地图；本世界固定为 (-LIMIT..LIMIT)²，
 * 这里采用固定北向上（-z 朝上），直接读取 connection.blocks 的最高方块上色，
 * 自身用白色箭头按 yaw 朝向绘制，其他在线玩家用蓝点表示。
 * 数据源全部来自 Connection，不依赖 3D 场景，rAF 刷新。
 */

const CELLS = LIMIT * 2 + 1; // 49 when LIMIT = 24
const CANVAS_SIZE = 200;
const PIXEL_RATIO = 2;

const MATERIAL_COLORS: Record<Material, [number, number, number]> = {
  grass: [86, 152, 50],
  dirt: [135, 88, 42],
  stone: [130, 130, 130],
  wood: [102, 70, 36],
  cobble: [118, 118, 118],
  sand: [228, 208, 148],
  planks: [196, 162, 100],
  leaves: [58, 122, 34],
  brick: [155, 60, 45],
  workbench: [138, 106, 58],
  water: [63, 127, 217],
};
const EMPTY_COLOR: [number, number, number] = [12, 14, 20];

interface MinimapProps {
  connection: Connection;
}

function paint(
  ctx: CanvasRenderingContext2D,
  connection: Connection,
  size: number,
  cell: number,
) {
  // 收集每一列最高的方块（俯视只画顶面）
  const top = new Map<string, { y: number; material: Material }>();
  for (const block of connection.blocks.values()) {
    const key = `${block.x},${block.z}`;
    const existing = top.get(key);
    if (!existing || block.y > existing.y) top.set(key, block);
  }

  ctx.clearRect(0, 0, size, size);
  for (let ix = 0; ix < CELLS; ix++) {
    for (let iz = 0; iz < CELLS; iz++) {
      const wx = -LIMIT + ix;
      const wz = -LIMIT + iz;
      const entry = top.get(`${wx},${wz}`);
      const color = entry ? MATERIAL_COLORS[entry.material] : EMPTY_COLOR;
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fillRect(ix * cell, iz * cell, cell + 0.5, cell + 0.5);
    }
  }

  // 世界边框
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = PIXEL_RATIO;
  ctx.strokeRect(0, 0, size, size);

  const toCanvas = (x: number, z: number) => ({
    cx: ((x + LIMIT) / CELLS) * size,
    cz: ((z + LIMIT) / CELLS) * size,
  });

  // 其他在线玩家：蓝点
  const self = connection.self;
  for (const p of connection.players) {
    if (self && p.id === self.id) continue;
    if (!p.connected) continue;
    const { cx, cz } = toCanvas(p.x, p.z);
    ctx.beginPath();
    ctx.fillStyle = '#7dd3fc';
    ctx.arc(cx, cz, 3.2 * PIXEL_RATIO, 0, Math.PI * 2);
    ctx.fill();
  }

  // 自身：白色箭头，按 yaw 朝向
  if (self) {
    const { cx, cz } = toCanvas(self.x, self.z);
    // 前进方向（与 scene.ts 移动向量一致）：dx=-sin(yaw), dz=-cos(yaw)
    const dx = -Math.sin(self.yaw);
    const dz = -Math.cos(self.yaw);
    const angle = Math.atan2(dz, dx);
    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(8 * PIXEL_RATIO, 0);
    ctx.lineTo(-5 * PIXEL_RATIO, 5.5 * PIXEL_RATIO);
    ctx.lineTo(-5 * PIXEL_RATIO, -5.5 * PIXEL_RATIO);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5 * PIXEL_RATIO;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function Minimap({ connection }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef<{
    ctx: CanvasRenderingContext2D;
    size: number;
    cell: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = CANVAS_SIZE * PIXEL_RATIO;
    canvas.width = size;
    canvas.height = size;
    const cell = size / CELLS;
    geoRef.current = { ctx, size, cell };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      try {
        paint(ctx, connection, size, cell);
      } catch {
        /* 单帧绘制失败不中断循环 */
      }
    };

    // 立即先画一帧，避免 rAF 未调度时地图空白
    paint(ctx, connection, size, cell);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [connection]);

  // 每次渲染兜底重绘：connection.onChange 触发 App 重渲染时同步刷新地图，
  // 不完全依赖 rAF（部分自动化/省电环境 rAF 可能停摆）。
  useEffect(() => {
    const geo = geoRef.current;
    if (!geo) return;
    try {
      paint(geo.ctx, connection, geo.size, geo.cell);
    } catch {
      /* ignore */
    }
  });

  const self: Player | undefined = connection.self;

  return (
    <div className="hud-minimap-card">
      <canvas
        ref={canvasRef}
        className="hud-minimap"
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        aria-label="世界小地图"
      />
      <div className="hud-coords" aria-live="off">
        {self
          ? `x ${Math.floor(self.x)} · y ${Math.floor(self.y)} · z ${Math.floor(self.z)}`
          : '连接中…'}
      </div>
    </div>
  );
}
