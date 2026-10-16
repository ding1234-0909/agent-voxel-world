import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { installSpeechRoutes } from './speech.routes';
import { LocalSpeech, SpeechError } from '../audio/local-speech';
describe('local speech HTTP boundary', () => {
  let server: Server, url: string;
  const transcribe = vi.fn();
  beforeEach(async () => {
    vi.stubEnv('WEB_ORIGIN', 'http://127.0.0.1:5187');
    vi.stubEnv('OLLAMA_MODEL', '');
    transcribe.mockReset().mockResolvedValue('hello');
    const speech = new LocalSpeech();
    vi.spyOn(speech, 'status').mockResolvedValue({
      available: true,
      reason: 'ready',
    });
    vi.spyOn(speech, 'transcribe').mockImplementation(transcribe);
    const app = express();
    installSpeechRoutes(app, speech);
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('advertises local readiness separately from optional Ollama configuration', async () => {
    const response = await fetch(`${url}/voice/capabilities`);
    expect(await response.json()).toMatchObject({
      local: { available: true },
      ollamaConfigured: false,
    });
  });
  it('allows the configured page preflight but rejects other origins', async () => {
    const allowed = await fetch(`${url}/voice/transcribe`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5187' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type',
    );
    const blocked = await fetch(`${url}/voice/transcribe`, {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'audio/wav' },
      body: 'test',
    });
    expect(blocked.status).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('passes audio to transcription and returns structured errors', async () => {
    const response = await fetch(`${url}/voice/transcribe?language=en`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: 'audio',
    });
    expect(await response.json()).toEqual({ text: 'hello' });
    expect(transcribe.mock.calls[0][0]).toEqual(Buffer.from('audio'));
    expect(transcribe.mock.calls[0][2]).toBe('en');
    transcribe.mockRejectedValueOnce(new SpeechError('busy', 429));
    const failed = await fetch(`${url}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: 'audio',
    });
    expect(failed.status).toBe(429);
    expect(await failed.json()).toEqual({ error: 'busy' });
  });
  it('rejects oversized bodies before invoking inference', async () => {
    const response = await fetch(`${url}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array(5 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
