import { EventEmitter } from 'node:events';
import type { RealtimeSocket } from './bailian';
/** Deterministic protocol simulator, not an AI and never a network transport. */
export class DemoSocket extends EventEmitter implements RealtimeSocket {
  bufferedAmount = 0;
  private stopped = false;
  private turn = 0;
  constructor() {
    super();
    queueMicrotask(() => {
      if (!this.stopped) this.emit('open');
    });
  }
  send(raw: string) {
    const event = JSON.parse(raw);
    if (event.type === 'session.update')
      this.deliver({ type: 'session.updated' });
    if (event.type === 'response.create') {
      const id = `demo-${++this.turn}`;
      this.deliver({ type: 'response.created', response: { id } });
      if (this.turn === 1) {
        this.deliver({
          type: 'response.function_call_arguments.done',
          response_id: id,
          call_id: 'demo-observe',
          name: 'observe_scene',
          arguments: '{}',
        });
      } else {
        const pcm = Buffer.alloc(12000);
        for (let i = 0; i < pcm.length / 2; i++)
          pcm.writeInt16LE(
            Math.round(Math.sin((i * Math.PI * 2 * 440) / 24000) * 1600),
            i * 2,
          );
        this.deliver({
          type: 'response.audio_transcript.delta',
          response_id: id,
          delta: '离线协议演示：这是合成提示音，不是真实 AI 回复。',
        });
        this.deliver({
          type: 'response.audio.delta',
          response_id: id,
          delta: pcm.toString('base64'),
        });
      }
      this.deliver({
        type: 'response.done',
        response: { id, status: 'completed' },
      });
    }
  }
  private deliver(event: unknown) {
    queueMicrotask(() => {
      if (!this.stopped) this.emit('message', JSON.stringify(event));
    });
  }
  close() {
    if (!this.stopped) {
      this.stopped = true;
      this.emit('close');
    }
  }
}
