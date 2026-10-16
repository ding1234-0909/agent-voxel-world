import type { ChatData, WorldEvent } from '@voxel/shared';

/** Live, addressed human messages only; never replay observation history. */
export class AgentAttention {
  private queue: WorldEvent[] = [];
  private lastSeq = 0;
  private wake?: () => void;
  get pending() {
    return this.queue.length > 0;
  }
  push(event: WorldEvent, self: string) {
    if (event.seq <= this.lastSeq) return false;
    this.lastSeq = event.seq;
    if (
      event.type !== 'chat' ||
      event.actor === self ||
      event.actorKind !== 'human'
    )
      return false;
    const data = event.data as ChatData;
    if (
      !['public', 'private', 'nearby'].includes(data.scope) ||
      !data.recipients.includes(self)
    )
      return false;
    this.queue.push(event);
    if (this.queue.length > 8) this.queue.shift();
    this.wake?.();
    return true;
  }
  take() {
    return this.queue.shift();
  }
  clear() {
    this.queue = [];
    this.wake?.();
  }
  async wait(ms: number, signal: AbortSignal) {
    if (this.pending || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wake = finish;
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
