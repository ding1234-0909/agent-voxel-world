import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VoiceServiceDraft } from '@voxel/shared';
import { SpeechError, validatePcmWav } from './local-speech';
import type { SpeechSynthesizer } from './local-tts';

const exec = promisify(execFile);
async function boundedBody(response: Response, limit: number) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new SpeechError(
      `语音服务返回 HTTP ${response.status}，请检查地址、密钥、模型和音色。`,
      502,
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new SpeechError('语音服务返回空响应。', 502);
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new SpeechError('语音服务响应过大。', 502);
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Normalize provider WAV output to the same bounded PCM format used by world audio. */
export async function normalizeSpeech(bytes: Buffer, signal: AbortSignal) {
  signal.throwIfAborted();
  try {
    return { bytes, durationMs: validatePcmWav(bytes, 90.5) };
  } catch {
    // Providers may return other WAV sample rates; convert those below.
  }
  if (
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new SpeechError('语音服务未返回 WAV 音频。', 502);
  const dir = await mkdtemp(join(tmpdir(), 'voxel-cloud-tts-'));
  try {
    const input = join(dir, 'input.wav'),
      output = join(dir, 'output.wav');
    await writeFile(input, bytes, { mode: 0o600 });
    await exec(
      process.env.FFMPEG_BIN ?? 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        input,
        '-t',
        '91',
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        output,
      ],
      { signal, timeout: 30000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' },
    );
    signal.throwIfAborted();
    const wav = await readFile(output);
    return { bytes: wav, durationMs: validatePcmWav(wav, 90.5) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class RemoteTts implements SpeechSynthesizer {
  constructor(
    private config: VoiceServiceDraft,
    private request = fetch,
  ) {}
  async synthesize(text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const c = this.config;
    const bailian = c.type === 'bailian';
    const response = await this.request(
      `${c.baseUrl}${
        bailian
          ? '/services/aigc/multimodal-generation/generation'
          : '/audio/speech'
      }`,
      {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
        },
        body: JSON.stringify(
          bailian
            ? {
                model: c.model,
                input: { text, voice: c.voice, language_type: 'Auto' },
              }
            : {
                model: c.model,
                input: text,
                voice: c.voice,
                speed: c.speed,
                response_format: 'wav',
              },
        ),
      },
    );
    let bytes = await boundedBody(
      response,
      bailian ? 64 * 1024 : 10 * 1024 * 1024,
    );
    if (bailian) {
      const data = JSON.parse(bytes.toString('utf8'));
      const url = new URL(data?.output?.audio?.url);
      // Provider output must not become an arbitrary authenticated server-side fetch.
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port ||
        !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(
          url.hostname,
        )
      )
        throw new SpeechError('百炼返回了无法识别的音频地址。', 502);
      url.protocol = 'https:';
      bytes = await boundedBody(
        await this.request(url, { signal, redirect: 'error' }),
        10 * 1024 * 1024,
      );
    }
    return normalizeSpeech(bytes, signal);
  }
}
