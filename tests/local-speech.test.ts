import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  LocalSpeech,
  validatePcmWav,
} from '../apps/server/src/audio/local-speech';
function wav(seconds = 1, amplitude = 1000) {
  const data = Buffer.alloc(44 + Math.round(seconds * 32000));
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 44; i < data.length; i += 2) data.writeInt16LE(amplitude, i);
  return data;
}
describe('local Whisper transcription', () => {
  let dir: string, model: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'speech-test-'));
    model = join(dir, 'model');
    await writeFile(model, Buffer.alloc(1024 * 1024));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('checks missing dependencies before recording is offered', async () => {
    expect(
      (await new LocalSpeech(join(dir, 'missing')).status()).available,
    ).toBe(false);
    expect(
      (await new LocalSpeech(model, join(dir, 'missing-binary')).status())
        .available,
    ).toBe(false);
  });
  it('rejects silence, malformed, too short and too long audio', () => {
    expect(() => validatePcmWav(wav(1, 0))).toThrow('清晰声音');
    expect(() => validatePcmWav(Buffer.from('invalid'))).toThrow();
    expect(() => validatePcmWav(wav(0.1))).toThrow('太短');
    expect(() => validatePcmWav(wav(21))).toThrow('20 秒');
  });
  it('normalizes audio, passes only fixed arguments, and removes temporary files', async () => {
    const runner = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes('-protocol_whitelist'))
        await writeFile(args.at(-1)!, wav());
      else
        await writeFile(
          `${args[args.indexOf('-of') + 1]}.txt`,
          '  你好，世界。\n',
        );
    });
    const speech = new LocalSpeech(
      model,
      process.execPath,
      process.execPath,
      runner,
    );
    const text = await speech.transcribe(
      Buffer.from('compressed'),
      'audio/webm;codecs=opus',
      'zh',
      new AbortController().signal,
    );
    expect(text).toBe('你好，世界。');
    expect(runner.mock.calls[0][1]).toContain('file,pipe');
    expect(runner.mock.calls[1][1]).toContain('zh');
    await expect(
      access(dirname(runner.mock.calls[0][1].at(-1)!)),
    ).rejects.toThrow();
  });
  it('rejects unsupported input before launching a subprocess', async () => {
    const runner = vi.fn();
    const speech = new LocalSpeech(
      model,
      process.execPath,
      process.execPath,
      runner,
    );
    await expect(
      speech.transcribe(
        Buffer.from('url'),
        'text/plain',
        'zh',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      speech.transcribe(
        Buffer.alloc(5 * 1024 * 1024 + 1),
        'audio/wav',
        'zh',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      speech.transcribe(
        Buffer.from('wav'),
        'audio/wav',
        '../x',
        new AbortController().signal,
      ),
    ).rejects.toThrow('中文');
    expect(runner).not.toHaveBeenCalled();
  });
  it('releases the busy slot and cleans files after subprocess failure', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('timeout'));
    const speech = new LocalSpeech(
      model,
      process.execPath,
      process.execPath,
      runner,
    );
    await expect(
      speech.transcribe(
        Buffer.from('x'),
        'audio/wav',
        'en',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      access(dirname(runner.mock.calls[0][1].at(-1))),
    ).rejects.toThrow();
    await expect(
      speech.transcribe(
        Buffer.from('x'),
        'audio/wav',
        'en',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('serializes inference and forwards cancellation', async () => {
    let started!: () => void;
    const start = new Promise<void>((r) => {
      started = r;
    });
    const runner = vi.fn(
      (_file: string, _args: string[], signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          started();
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const speech = new LocalSpeech(
      model,
      process.execPath,
      process.execPath,
      runner,
    );
    const controller = new AbortController();
    const first = speech.transcribe(
      Buffer.from('x'),
      'audio/wav',
      'en',
      controller.signal,
    );
    const rejected = expect(first).rejects.toThrow();
    await start;
    await expect(
      speech.transcribe(
        Buffer.from('x'),
        'audio/wav',
        'en',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 429 });
    controller.abort();
    await rejected;
  });
});
