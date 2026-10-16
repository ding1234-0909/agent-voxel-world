import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import express from 'express';
import { LocalSpeech } from '../../src/audio/local-speech';
import { installSpeechRoutes } from '../../src/routes/speech.routes';
import {
  LiveSpeechSession,
  speechTransport,
} from '../../../web/src/audio/live-speech';

// No database, game world, microphone, cloud provider or paid model is used.
const realFile = process.env.ASR_TEST_WAV;
const speech = new LocalSpeech();
if (!realFile) {
  speech.status = async () => ({ available: true, reason: 'fixture' });
  speech.transcribe = async (bytes) =>
    `识别 ${Math.round((bytes.length - 44) / 32)} 毫秒`;
}
const app = express();
installSpeechRoutes(app, speech);
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition: () => boolean, timeout = 35000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout)
      throw Error('Timed out waiting for live transcript');
    await pause(20);
  }
};
const timeline: { kind: string; text: string; atMs: number }[] = [];
const started = Date.now();
let ended = false,
  feeding = true,
  earlyPreview = false;
const session = new LiveSpeechSession(
  speechTransport('zh', undefined, (input, init) => {
    const target = new URL(String(input));
    return fetch(`${url}${target.pathname}${target.search}`, init);
  }),
  {
    onPartial: (text) => {
      if (text) {
        timeline.push({ kind: 'partial', text, atMs: Date.now() - started });
        if (feeding) earlyPreview = true;
      }
    },
    onFinal: (text) =>
      timeline.push({ kind: 'final', text, atMs: Date.now() - started }),
    onStatus: () => {},
    onError: (text) =>
      timeline.push({ kind: 'error', text, atMs: Date.now() - started }),
    onEnd: () => {
      ended = true;
    },
  },
);
try {
  if (realFile) {
    const wav = await readFile(realFile);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    let pcm: Buffer | undefined;
    for (let offset = 12; offset + 8 <= wav.length; ) {
      const size = wav.readUInt32LE(offset + 4);
      if (wav.toString('ascii', offset, offset + 4) === 'fmt ') {
        assert.equal(wav.readUInt16LE(offset + 8), 1);
        assert.equal(wav.readUInt16LE(offset + 10), 1);
        assert.equal(wav.readUInt32LE(offset + 12), 16000);
        assert.equal(wav.readUInt16LE(offset + 22), 16);
      }
      if (wav.toString('ascii', offset, offset + 4) === 'data')
        pcm = wav.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert(pcm?.length, 'Use mono PCM16 16kHz WAV');
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      session.feed(new Uint8Array(pcm.subarray(offset, offset + 3200)));
      await pause(100);
    }
  } else {
    const pcm = new Uint8Array(3200),
      view = new DataView(pcm.buffer);
    for (let i = 0; i < pcm.length; i += 2) view.setInt16(i, 2000, true);
    for (let i = 0; i < 12; i++) session.feed(pcm);
    await until(() => timeline.some((entry) => entry.kind === 'partial'));
    assert(!timeline.some((entry) => entry.kind === 'final'));
    for (let i = 0; i < 12; i++) session.feed(pcm);
    await until(
      () => timeline.filter((entry) => entry.kind === 'partial').length >= 2,
    );
  }
  feeding = false;
  for (let i = 0; i < 9; i++) session.feed(new Uint8Array(3200));
  session.finish();
  await until(() => ended || timeline.some((entry) => entry.kind === 'error'));
  assert(
    !timeline.some((entry) => entry.kind === 'error'),
    JSON.stringify(timeline),
  );
  assert(
    earlyPreview,
    'A provisional result must arrive before audio input ends',
  );
  assert(timeline.some((entry) => entry.kind === 'final'));
  assert(ended);
  console.log(
    JSON.stringify(
      {
        mode: realFile
          ? 'real self-hosted Whisper'
          : 'fixed-response HTTP integration',
        earlyPreview,
        timeline,
      },
      null,
      2,
    ),
  );
} finally {
  session.cancel();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
