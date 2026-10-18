// ============================================================================
// 合成界面开关（UI 状态）。UI 组件订阅；3D 场景在右键点击世界中的工作台时
// 调用 openCrafting(3) 打开 3x3 合成。
// ============================================================================

type Listener = () => void;

class CraftingUI {
  private open = false;
  private size: 2 | 3 = 2;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  isOpen(): boolean {
    return this.open;
  }

  getSize(): 2 | 3 {
    return this.size;
  }

  /** 打开随身 2x2 合成（按 E）或工作台 3x3 */
  openCrafting(size: 2 | 3 = 2): void {
    this.size = size;
    this.open = true;
    this.emit();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit();
  }

  toggle(): void {
    this.open ? this.close() : this.openCrafting(2);
  }
}

export const craftingUI = new CraftingUI();
