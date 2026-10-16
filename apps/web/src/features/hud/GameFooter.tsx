import type { Material } from '@voxel/shared';
import { ControlsHelp } from './ControlsHelp';

interface GameFooterProps {
  material: Material;
  isConnected: boolean;
  showControls: boolean;
  onToggleControls: () => void;
  onCloseControls: () => void;
  onSelectMaterial: (m: Material) => void;
  onEditBlock: (place: boolean) => void;
}

const MATERIALS: Material[] = ['grass', 'dirt', 'stone', 'wood'];

export function GameFooter({
  material,
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
      <div className="hotbar">
        {MATERIALS.map((m, i) => (
          <button
            key={m}
            aria-pressed={material === m}
            onClick={() => onSelectMaterial(m)}
          >
            <span className={`swatch ${m}`} />
            <small>
              {i + 1} {m}
            </small>
          </button>
        ))}
      </div>
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
