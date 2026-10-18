import type { Material } from '@voxel/shared';
import { ControlsHelp } from './ControlsHelp';
import { Hotbar } from '../survival/Hotbar';

interface GameFooterProps {
  isConnected: boolean;
  showControls: boolean;
  onToggleControls: () => void;
  onCloseControls: () => void;
  onSelectMaterial: (m: Material) => void;
  onEditBlock: (place: boolean) => void;
}

export function GameFooter({
  isConnected,
  showControls,
  onToggleControls,
  onCloseControls,
  onSelectMaterial,
  onEditBlock,
}: GameFooterProps) {
  return (
    <footer>
      <div className="controls">
        <button
          className="controls-toggle"
          aria-expanded={showControls}
          aria-controls="controls-help"
          onClick={onToggleControls}
        >
          <span aria-hidden="true">?</span> 操作帮助
        </button>
        {showControls && <ControlsHelp onClose={onCloseControls} />}
      </div>

      {/* 快捷栏：inventory 前 9 格驱动（数字键 1-9 / 滚轮 / 点击切换） */}
      <Hotbar onSelectMaterial={onSelectMaterial} />

      <div className="build-actions">
        <button disabled={!isConnected} onClick={() => onEditBlock(false)}>
          Remove
        </button>
        <button disabled={!isConnected} onClick={() => onEditBlock(true)}>
          Place block
        </button>
      </div>
    </footer>
  );
}
