import { LocalSpeech, SpeechError } from './local-speech';

type Job = { run: () => Promise<void>; cancel: () => void };
/** Final sentences wait in a bounded queue. Obsolete previews never queue. */
export class SpeechScheduler {
  private running = false;
  private queue: Job[] = [];
  constructor(private speech: LocalSpeech) {}
  transcribe(
    audio: Buffer,
    type: string,
    language: string,
    signal: AbortSignal,
    partial = false,
  ): Promise<string> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if ((partial && this.running) || this.queue.length >= 4)
      return Promise.reject(new SpeechError('识别服务繁忙，请稍后重试。', 429));
    return new Promise((resolve, reject) => {
      const timeout = new AbortController();
      const combined = AbortSignal.any([signal, timeout.signal]);
      const timer = setTimeout(
        () =>
          timeout.abort(
            new SpeechError('识别超时，请缩短句子或稍后重试。', 504),
          ),
        partial ? 8000 : 90000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        combined.removeEventListener('abort', job.cancel);
      };
      const job: Job = {
        cancel: () => {
          const index = this.queue.indexOf(job);
          if (index !== -1) {
            this.queue.splice(index, 1);
            cleanup();
            reject(combined.reason);
          }
        },
        run: async () => {
          try {
            combined.throwIfAborted();
            const text = await this.speech.transcribe(
              audio,
              type,
              language,
              combined,
            );
            combined.throwIfAborted();
            resolve(text);
          } catch (error) {
            reject(combined.aborted ? combined.reason : error);
          } finally {
            cleanup();
            this.running = false;
            this.pump();
          }
        },
      };
      combined.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  private pump() {
    if (this.running) return;
    const job = this.queue.shift();
    if (job) {
      this.running = true;
      void job.run();
    }
  }
}
const schedulers = new WeakMap<LocalSpeech, SpeechScheduler>();
export function scheduleSpeech(speech: LocalSpeech) {
  let scheduler = schedulers.get(speech);
  if (!scheduler) {
    scheduler = new SpeechScheduler(speech);
    schedulers.set(speech, scheduler);
  }
  return scheduler;
}
