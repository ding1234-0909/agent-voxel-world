// ============================================================================
// 背包系统（移植自源码 1261-1267、掉落物拾取 2372-2412、hotbar 逻辑）
// 36 格：0-8 为快捷栏，9-35 为背包。localStorage 跨会话持久化。
// 这是纯 UI 无关的单例 store：React 组件通过 subscribe 订阅；3D 场景
// （掉落物拾取、放置扣减）直接调用 add/consume。
// ============================================================================

import {
  HOTBAR,
  ITEMS,
  type ItemId,
} from './items';

const STORAGE_KEY = 'mcInventory:v1';
const SLOT_COUNT = 36;
const HOTBAR_COUNT = 9;

export interface Slot {
  id: ItemId;
  count: number;
}

export interface InventorySnapshot {
  slots: Slot[];
  selected: number;
}

type Listener = () => void;

function emptySlots(): Slot[] {
  return Array.from({ length: SLOT_COUNT }, () => ({ id: '' as ItemId, count: 0 }));
}

function starterSlots(): Slot[] {
  const slots = emptySlots();
  // 初始快捷栏：与源码一致，每种方块给一组（64）
  for (let i = 0; i < HOTBAR.length; i++) {
    slots[i] = { id: HOTBAR[i]!, count: 64 };
  }
  return slots;
}

class Inventory {
  private slots: Slot[] = starterSlots();
  private selected = 0;
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.save();
    for (const fn of this.listeners) fn();
  }

  getSnapshot(): InventorySnapshot {
    return {
      slots: this.slots.map((s) => ({ ...s })),
      selected: this.selected,
    };
  }

  getSlots(): readonly Slot[] {
    return this.slots;
  }

  getSelected(): number {
    return this.selected;
  }

  setSelected(index: number): void {
    if (index < 0 || index >= HOTBAR_COUNT) return;
    this.selected = index;
    this.emit();
  }

  /** 当前快捷栏选中的物品 id（'' 表示空槽） */
  selectedItem(): ItemId | null {
    const s = this.slots[this.selected]!;
    return s.count > 0 ? s.id : null;
  }

  /** 背包内某物品的总数 */
  count(id: ItemId): number {
    return this.slots.reduce((sum, s) => (s.id === id ? sum + s.count : sum), 0);
  }

  /**
   * 把物品放入背包：优先堆叠到同种未满的格子，再放空槽。
   * 返回实际放入数量（背包满时可能小于 n）。
   */
  add(id: ItemId, n = 1): number {
    if (n <= 0 || !(id in ITEMS)) return 0;
    let remaining = n;
    const max = ITEMS[id]!.maxStack;
    for (const s of this.slots) {
      if (remaining <= 0) break;
      if (s.id === id && s.count < max) {
        const take = Math.min(remaining, max - s.count);
        s.count += take;
        remaining -= take;
      }
    }
    for (const s of this.slots) {
      if (remaining <= 0) break;
      if (s.count === 0) {
        const take = Math.min(remaining, max);
        s.id = id;
        s.count = take;
        remaining -= take;
      }
    }
    this.emit();
    return n - remaining;
  }

  /** 背包中是否至少有 n 个某物品 */
  has(id: ItemId, n = 1): boolean {
    return this.count(id) >= n;
  }

  /** 从背包扣除 n 个某物品（跨格子），不足时返回 false 且不动数据 */
  consume(id: ItemId, n = 1): boolean {
    if (!this.has(id, n)) return false;
    let need = n;
    for (const s of this.slots) {
      if (need <= 0) break;
      if (s.id === id) {
        const take = Math.min(need, s.count);
        s.count -= take;
        need -= take;
        if (s.count === 0) s.id = '' as ItemId;
      }
    }
    this.emit();
    return true;
  }

  /** 把某格的物品拿走（鼠标拿起/整格操作） */
  takeSlot(index: number): Slot {
    const s = this.slots[index]!;
    const taken = { ...s };
    s.id = '' as ItemId;
    s.count = 0;
    this.emit();
    return taken;
  }

  /** 向格子放入一整组（仅在空槽或同种时；返回放不下的部分） */
  putSlot(index: number, slot: Slot): Slot {
    const target = this.slots[index]!;
    if (slot.count === 0) return slot;
    if (target.count === 0) {
      const max = ITEMS[slot.id]!.maxStack;
      const take = Math.min(slot.count, max);
      target.id = slot.id;
      target.count = take;
      const rest = slot.count - take;
      this.emit();
      return { id: slot.id, count: rest };
    }
    if (target.id === slot.id) {
      const max = ITEMS[target.id]!.maxStack;
      const take = Math.min(slot.count, max - target.count);
      target.count += take;
      this.emit();
      return { id: slot.id, count: slot.count - take };
    }
    return slot;
  }

  /** 向格子放一个（右键分发），返回是否放入 */
  putOne(index: number, id: ItemId): boolean {
    const target = this.slots[index]!;
    const max = ITEMS[id]!.maxStack;
    if (target.count === 0) {
      target.id = id;
      target.count = 1;
      this.emit();
      return true;
    }
    if (target.id === id && target.count < max) {
      target.count++;
      this.emit();
      return true;
    }
    return false;
  }

  /** 从格子取一个（右键拿起），返回物品 id（0 表示空） */
  takeOne(index: number): ItemId | '' {
    const target = this.slots[index]!;
    if (target.count === 0) return '';
    const id = target.id;
    target.count--;
    if (target.count === 0) target.id = '' as ItemId;
    this.emit();
    return id;
  }

  clear(): void {
    this.slots = emptySlots();
    this.emit();
  }

  resetStarter(): void {
    this.slots = starterSlots();
    this.selected = 0;
    this.emit();
  }

  private save(): void {
    try {
      const data = JSON.stringify({
        slots: this.slots.map((s) => (s.count ? [s.id, s.count] : 0)),
        selected: this.selected,
      });
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      // 隐私模式等情况下忽略持久化失败
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        slots?: Array<[ItemId, number] | 0>;
        selected?: number;
      };
      if (Array.isArray(data.slots) && data.slots.length === SLOT_COUNT) {
        this.slots = data.slots.map((entry) =>
          Array.isArray(entry)
            ? { id: entry[0], count: entry[1] }
            : { id: '' as ItemId, count: 0 },
        );
      }
      if (typeof data.selected === 'number')
        this.selected = Math.max(0, Math.min(HOTBAR_COUNT - 1, data.selected));
    } catch {
      // 存档损坏则使用初始背包
    }
  }
}

export const inventory = new Inventory();
