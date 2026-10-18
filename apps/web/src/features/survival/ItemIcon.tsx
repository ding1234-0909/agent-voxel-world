// ============================================================================
// 物品图标（canvas）+ 数量角标的复用组件。
// 绘制逻辑来自 game/items.ts 的 drawItemIcon（源码 2962-3030 行）。
// ============================================================================

import { useEffect, useRef } from 'react';
import { drawItemIcon, type ItemId } from '../../game/items';

interface ItemIconProps {
  id: ItemId | 0;
  size?: number;
  /** 数量；>1 时显示右下角角标 */
  count?: number;
}

export function ItemIcon({ id, size = 32, count }: ItemIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawItemIcon(canvasRef.current, id);
  }, [id, size]);

  return (
    <span className="survival-icon">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
      {typeof count === 'number' && count > 1 && (
        <span className="survival-count">{count}</span>
      )}
    </span>
  );
}
