import { serverHttpUrl } from './endpoints';
import type { WorldPresence } from '@voxel/shared';

export class PresenceSubscription {
  data?: WorldPresence;
  status: 'loading' | 'live' | 'reconnecting' = 'loading';
  onChange = () => {};
  private stream?: EventSource;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;

  start() {
    if (this.stream) return;
    clearTimeout(this.retry);
    const endpoint = serverHttpUrl();
    const stream = new EventSource(`${endpoint}/world/presence`);
    this.stream = stream;
    const stale = () => {
      if (this.stream !== stream) return;
      stream.close();
      this.stream = undefined;
      clearTimeout(this.heartbeat);
      this.status = 'reconnecting';
      this.onChange();
      this.retry = setTimeout(() => this.start(), 2000);
    };
    this.heartbeat = setTimeout(stale, 5000);
    stream.onmessage = (message) => {
      if (this.stream !== stream) return;
      try {
        this.data = JSON.parse(message.data) as WorldPresence;
        this.status = 'live';
        clearTimeout(this.heartbeat);
        this.heartbeat = setTimeout(stale, 5000);
        this.onChange();
      } catch {
        stale();
      }
    };
    // Retry even terminal HTTP failures (for example, a service starting up).
    // Retain the last snapshot with an explicit stale label.
    stream.onerror = stale;
  }

  stop() {
    this.stream?.close();
    this.stream = undefined;
    clearTimeout(this.heartbeat);
    clearTimeout(this.retry);
  }
}
