// ============================================================================
// 背包 + 合成界面（移植自源码 62-94 样式、3062-3271 合成与交互逻辑）
// - E 键开合随身 2x2 合成；craftingUI.openCrafting(3) 由 3D 组右键工作台触发，
//   这里渲染 3x3；Esc / 关闭按钮 / 点击遮罩关闭。
// - <dialog open>：scene.ts 的 keydown 已对 dialog[open] 豁免移动按键。
// - 左键整组拿起/放置/交换，右键放一个/取一半；结果槽点击合成并扣材料。
// - 关闭时把合成格与鼠标上的物品放回背包（源码 closeCraft 3253-3268）。
// ============================================================================

import { useEffect, useReducer, useRef, useState } from 'react';
import { craftingUI } from '../../game/crafting';
import { inventory, type Slot } from '../../game/inventory';
import { ITEMS, matchRecipe, type ItemId } from '../../game/items';
import { sfx } from '../../game/sounds';
import { releasePointerLock } from '../../utils/pointer-lock';
import { ItemIcon } from './ItemIcon';

type Cursor = { id: ItemId; count: number } | null;

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && !!el.closest('input,textarea,select,[contenteditable="true"]');
}

export function InventoryPanel() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [open, setOpen] = useState(craftingUI.isOpen());
  const [size, setSize] = useState<2 | 3>(craftingUI.getSize());
  const [craftSlots, setCraftSlots] = useState<(ItemId | 0)[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const craftRef = useRef<(ItemId | 0)[]>([]);
  craftRef.current = craftSlots;
  const cursorRef = useRef<Cursor>(null);
  cursorRef.current = cursor;
  const sizeRef = useRef<2 | 3>(size);
  sizeRef.current = size;

  /** 关闭时把合成格 / 鼠标上的物品退回背包（源码 closeCraft） */
  const returnLeftovers = () => {
    for (const cell of craftRef.current) {
      if (cell) inventory.add(cell, 1);
    }
    const cur = cursorRef.current;
    if (cur && cur.count > 0) inventory.add(cur.id, cur.count);
  };

  // 订阅合成开关（E 开合、3D 工作台 openCrafting(3)、外部 close）
  useEffect(
    () =>
      craftingUI.subscribe(() => {
        const isOpen = craftingUI.isOpen();
        setOpen(isOpen);
        setSize(craftingUI.getSize());
        if (isOpen) {
          releasePointerLock();
          const n = craftingUI.getSize() ** 2;
          setCraftSlots(Array<ItemId | 0>(n).fill(0));
          setCursor(null);
        } else {
          returnLeftovers();
          setCursor(null);
          setCraftSlots([]);
        }
        force();
      }),
    [],
  );

  // 背包数量变化（拾取、合成、放置）刷新界面
  useEffect(() => inventory.subscribe(force), []);

  const closePanel = () => {
    // 退回背包由 craftingUI.close() 的订阅回调统一处理，避免重复 add
    craftingUI.close();
    releasePointerLock();
  };

  // E 开合 / Esc 关闭（源码 3376-3383、3389-3390）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) {
        if (e.code === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (craftingUI.isOpen()) {
          closePanel();
        } else {
          releasePointerLock();
          craftingUI.openCrafting(2);
        }
      } else if (e.code === 'Escape' && craftingUI.isOpen()) {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跟随鼠标的拿起物
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const setCell = (i: number, v: ItemId | 0) =>
    setCraftSlots((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });

  // 合成格点击（源码 craftCellClick 3188-3208）
  const craftCellMouse = (i: number, right: boolean) => {
    const cur = cursorRef.current;
    const cell = craftRef.current[i] ?? 0;
    if (right) {
      if (cur && cur.count > 0) {
        if (!cell || cell === cur.id) {
          setCell(i, cur.id);
          setCursor((p) => (p && p.count - 1 > 0 ? { ...p, count: p.count - 1 } : null));
          sfx.click();
        }
      } else if (cell) {
        setCursor({ id: cell, count: 1 });
        setCell(i, 0);
        sfx.click();
      }
    } else {
      if (cur) {
        if (!cell) {
          // 合成格只放 1 个，剩余留在鼠标上（与右键一致）
          setCell(i, cur.id);
          setCursor((p) =>
            p && p.count - 1 > 0 ? { ...p, count: p.count - 1 } : null,
          );
          sfx.click();
        } else if (cell === cur.id) {
          setCursor(null);
          sfx.click();
        } else {
          setCell(i, cur.id);
          setCursor({ id: cell, count: 1 });
          sfx.click();
        }
      } else if (cell) {
        setCursor({ id: cell, count: 1 });
        setCell(i, 0);
        sfx.click();
      }
    }
  };

  // 背包 36 格点击（源码 craftInvClick 3210-3233）
  const invSlotMouse = (index: number, right: boolean) => {
    const cur = cursorRef.current;
    const target = inventory.getSnapshot().slots[index]!;
    if (right) {
      if (cur && cur.count > 0) {
        if (inventory.putOne(index, cur.id)) {
          setCursor((p) =>
            p && p.count - 1 > 0 ? { ...p, count: p.count - 1 } : null,
          );
          sfx.click();
        }
      } else if (target.count > 0) {
        const half = Math.ceil(target.count / 2);
        const taken = inventory.takeSlot(index);
        const rest = taken.count - half;
        if (rest > 0) inventory.putSlot(index, { id: taken.id, count: rest });
        setCursor({ id: taken.id, count: half });
        sfx.click();
      }
      return;
    }
    if (cur) {
      if (target.count === 0 || target.id === cur.id) {
        const leftover = inventory.putSlot(index, { id: cur.id, count: cur.count });
        setCursor(leftover.count > 0 ? leftover : null);
        sfx.click();
      } else {
        const existing = inventory.takeSlot(index);
        inventory.putSlot(index, { id: cur.id, count: cur.count });
        setCursor(existing.count > 0 ? existing : null);
        sfx.click();
      }
    } else if (target.count > 0) {
      const taken = inventory.takeSlot(index);
      setCursor(taken.count > 0 ? taken : null);
      sfx.click();
    }
  };

  // 结果槽点击：校验背包空间 → 清空合成格 → 放入结果（源码 craftOutputClick 3235-3251）
  const craftOutput = () => {
    const res = matchRecipe(craftRef.current, sizeRef.current);
    if (!res) return;
    const snap = inventory.getSnapshot();
    const canAdd = snap.slots.some(
      (s: Slot) =>
        s.count === 0 || (s.id === res.result && s.count < ITEMS[res.result]!.maxStack),
    );
    if (!canAdd) return;
    setCraftSlots(Array<ItemId | 0>(sizeRef.current ** 2).fill(0));
    inventory.add(res.result, res.count);
    sfx.craft();
  };

  if (!open) return null;

  const snap = inventory.getSnapshot();
  const result = matchRecipe(craftSlots, size);

  return (
    <dialog
      className="survival-dialog"
      open
      onContextMenu={(e) => e.preventDefault()}
      aria-label={size === 3 ? '工作台 · 合成' : '随身合成'}
    >
      <div className="survival-backdrop" onClick={closePanel} />
      <div className="survival-panel" role="presentation">
        <div className="survival-title">
          <span>{size === 3 ? '工作台 · 合成' : '随身合成'}</span>
          <button
            type="button"
            className="survival-close"
            aria-label="关闭合成界面"
            onClick={closePanel}
          >
            ×
          </button>
        </div>
        <div className="survival-body">
          <div className="craft-main-row">
            <div className={`craft-grid size${size}`}>
              {craftSlots.map((id, i) => (
                <button
                  key={i}
                  type="button"
                  className="craft-cell"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    craftCellMouse(i, e.button === 2);
                  }}
                >
                  <ItemIcon id={id} size={36} />
                </button>
              ))}
            </div>
            <span className="craft-arrow" aria-hidden="true">
              ➜
            </span>
            <button
              type="button"
              className="craft-output"
              onMouseDown={(e) => {
                e.preventDefault();
                if (e.button === 0) craftOutput();
              }}
            >
              {result && (
                <ItemIcon id={result.result} size={44} count={result.count} />
              )}
            </button>
          </div>

          <div className="craft-inv-label">背包</div>
          <div className="craft-inv">
            {snap.slots.map((slot, i) => (
              <button
                key={i}
                type="button"
                className="craft-cell craft-cell--inv"
                title={slot.count > 0 ? ITEMS[slot.id]!.name : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  invSlotMouse(i, e.button === 2);
                }}
              >
                <ItemIcon
                  id={slot.count > 0 ? slot.id : 0}
                  size={32}
                  count={slot.count}
                />
              </button>
            ))}
          </div>

          <div className="craft-hint">左键拿起 / 整组放置 · 右键放一个 / 取一半 · E 关闭</div>
        </div>
      </div>

      {cursor && (
        <div
          className="survival-cursor"
          style={{ left: mouse.x, top: mouse.y }}
          aria-hidden="true"
        >
          <ItemIcon id={cursor.id} size={32} count={cursor.count} />
        </div>
      )}
    </dialog>
  );
}
