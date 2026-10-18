// ============================================================================
// 快捷栏（移植自源码 3358-3406 滚轮/数字键、3455-3484 buildHotbar/refreshHotbar）
// 由 inventory 前 9 格驱动：数字键 1-9、鼠标滚轮循环、点击格子切换。
// 选中「可放置方块」时把材质同步给世界（onSelectMaterial → WorldScene.material）；
// 选中工具/食物等非方块时不改材质。合成界面打开、焦点在输入框时不响应。
// ============================================================================

import { useEffect, useReducer, useRef } from 'react';
import type { Material } from '@voxel/shared';
import { inventory } from '../../game/inventory';
import { craftingUI } from '../../game/crafting';
import { ITEMS, isPlaceable } from '../../game/items';
import { sfx } from '../../game/sounds';
import { ItemIcon } from './ItemIcon';

const HOTBAR_COUNT = 9;

interface HotbarProps {
  onSelectMaterial: (m: Material) => void;
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && !!el.closest('input,textarea,select,[contenteditable="true"]');
}

export function Hotbar({ onSelectMaterial }: HotbarProps) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const onSelectRef = useRef(onSelectMaterial);
  onSelectRef.current = onSelectMaterial;

  useEffect(() => inventory.subscribe(force), []);

  /** 选中第 index 格；仅当选中的是方块时把材质写进世界 */
  const select = (index: number, silent = false) => {
    inventory.setSelected(index);
    const id = inventory.selectedItem();
    if (id && isPlaceable(id)) {
      onSelectRef.current(id as Material);
    }
    if (!silent) sfx.click();
  };

  // 进世界时把当前选中方块同步给世界材质（源码 updateHandTex 的初始同步）
  useEffect(() => {
    const id = inventory.selectedItem();
    if (id && isPlaceable(id)) onSelectRef.current(id as Material);
  }, []);

  // 数字键 1-9（源码 3404-3406）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (craftingUI.isOpen() || isTyping()) return;
      if (!e.code.startsWith('Digit')) return;
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= HOTBAR_COUNT) {
        e.preventDefault();
        select(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 滚轮循环（源码 3358）：指针锁定中或鼠标悬停在快捷栏上才响应，避免劫持页面滚动
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (craftingUI.isOpen() || isTyping()) return;
      const target = e.target as HTMLElement | null;
      const locked = !!document.pointerLockElement;
      if (!locked && !target?.closest('.survival-hotbar')) return;
      e.preventDefault();
      const cur = inventory.getSelected();
      const next = (cur + (e.deltaY > 0 ? 1 : -1) + HOTBAR_COUNT) % HOTBAR_COUNT;
      select(next);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const snap = inventory.getSnapshot();
  const selectedSlot = snap.slots[snap.selected]!;
  const selectedId = selectedSlot.count > 0 ? selectedSlot.id : null;

  return (
    <div className="survival-hotbar" aria-label="快捷栏">
      <div className="hotbar-name">
        {selectedId ? ITEMS[selectedId]!.name : ''}
      </div>
      <div className="survival-hotbar__row">
        {snap.slots.slice(0, HOTBAR_COUNT).map((slot, i) => (
          <button
            key={i}
            type="button"
            className={`survival-slot${i === snap.selected ? ' sel' : ''}`}
            aria-pressed={i === snap.selected}
            title={slot.count > 0 ? ITEMS[slot.id]!.name : '空槽'}
            onClick={() => select(i)}
          >
            <span className="survival-slot__num">{i + 1}</span>
            <ItemIcon
              id={slot.count > 0 ? slot.id : 0}
              size={32}
              count={slot.count}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
