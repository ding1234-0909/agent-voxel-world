import { expect, it, vi } from 'vitest';
import { SpeechScheduler } from '../apps/server/src/audio/speech-scheduler';
import { LocalSpeech } from '../apps/server/src/audio/local-speech';
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
it('drops previews under load but processes queued final sentences in order', async () => {
  const speech = new LocalSpeech();
  let done!: (text: string) => void;
  const infer = vi
    .spyOn(speech, 'transcribe')
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        }),
    )
    .mockResolvedValue('second');
  const scheduler = new SpeechScheduler(speech),
    signal = new AbortController().signal;
  const first = scheduler.transcribe(
    Buffer.from('1'),
    'audio/wav',
    'zh',
    signal,
    true,
  );
  await expect(
    scheduler.transcribe(
      Buffer.from('preview'),
      'audio/wav',
      'zh',
      signal,
      true,
    ),
  ).rejects.toMatchObject({ status: 429 });
  const second = scheduler.transcribe(
    Buffer.from('2'),
    'audio/wav',
    'zh',
    signal,
  );
  expect(infer).toHaveBeenCalledOnce();
  done('first');
  expect(await first).toBe('first');
  expect(await second).toBe('second');
  expect(infer).toHaveBeenCalledTimes(2);
});
it('cancels queued work before it can run', async () => {
  const speech = new LocalSpeech();
  let done!: (text: string) => void;
  const infer = vi.spyOn(speech, 'transcribe').mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const scheduler = new SpeechScheduler(speech),
    controller = new AbortController();
  const first = scheduler.transcribe(
    Buffer.from('1'),
    'audio/wav',
    'zh',
    new AbortController().signal,
  );
  const queued = scheduler.transcribe(
    Buffer.from('2'),
    'audio/wav',
    'zh',
    controller.signal,
  );
  const rejected = expect(queued).rejects.toThrow();
  controller.abort();
  await rejected;
  done('first');
  await first;
  await flush();
  expect(infer).toHaveBeenCalledOnce();
});
it('bounds the final queue and does not retry unknown outcomes', async () => {
  const speech = new LocalSpeech();
  let fail!: (error: Error) => void;
  const infer = vi
    .spyOn(speech, 'transcribe')
    .mockImplementationOnce(
      () =>
        new Promise((_r, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue('ok');
  const scheduler = new SpeechScheduler(speech),
    signal = new AbortController().signal;
  const first = scheduler.transcribe(
    Buffer.from('1'),
    'audio/wav',
    'zh',
    signal,
  );
  const rejection = expect(first).rejects.toThrow('unknown');
  const queued = Array.from({ length: 4 }, () =>
    scheduler.transcribe(Buffer.from('2'), 'audio/wav', 'zh', signal),
  );
  await expect(
    scheduler.transcribe(Buffer.from('overflow'), 'audio/wav', 'zh', signal),
  ).rejects.toMatchObject({ status: 429 });
  fail(Error('unknown'));
  await rejection;
  await Promise.all(queued);
  expect(infer).toHaveBeenCalledTimes(5);
});
