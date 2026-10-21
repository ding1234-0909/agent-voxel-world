import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { BailianAsrDraft } from '@voxel/shared';

/** 阿里云百炼实时语音识别的一次性转写（推完 PCM 后收 final 关闭）。 */
export function bailianEndpoint(settings: BailianAsrDraft): string {
  const host =
    settings.region === 'singapore'
      ? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference'
      : 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
  return host;
}

function friendlyError(status: number | undefined): string {
  if (status === 401) return '阿里云识别认证失败（401），请检查 API Key。';
  if (status === 403) return '阿里云拒绝识别（403），请检查业务空间与权限。';
  if (status === 429) return '阿里云识别请求过于频繁（429），请稍后重试。';
  if (status && status >= 500) return '阿里云识别服务暂时不可用，请稍后重试。';
  return '阿里云识别握手失败，请检查地域、业务空间与接口配置。';
}

export interface BailianResult {
  text: string;
  elapsedMs: number;
}

export function transcribeWithBailian(
  pcm: Buffer,
  language: 'zh' | 'en',
  settings: BailianAsrDraft,
  timeoutMs = 30000,
): Promise<BailianResult> {
  const taskId = randomUUID();
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let upstream: WebSocket;
    let done = false;
    let sentences = '';
    let began = false;
    const finish = (error?: string, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      try {
        upstream?.terminate();
      } catch {
        /* 忽略 */
      }
      if (error) reject(new Error(error));
      else resolve({ text: text ?? '', elapsedMs: Date.now() - startedAt });
    };
    const deadline = setTimeout(
      () => finish('阿里云识别超时，请检查配置后重试。'),
      timeoutMs,
    );
    try {
      upstream = new WebSocket(bailianEndpoint(settings), {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        handshakeTimeout: 10000,
        maxPayload: 256 * 1024,
        perMessageDeflate: false,
      });
    } catch {
      finish('无法连接阿里云识别服务，请检查配置。');
      return;
    }
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')
        finish('无法解析阿里云识别地址，请检查服务器网络。');
      else if (error.code === 'ETIMEDOUT')
        finish('连接阿里云识别超时，请检查服务器网络。');
      else if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET')
        finish('与阿里云识别连接被拒绝或重置。');
      else finish('连接阿里云识别失败，请检查服务器网络。');
    });
    upstream.on('unexpected-response', (_request, response) => {
      finish(friendlyError(response.statusCode));
      response.destroy();
    });
    const header = (action: string) => ({
      action,
      task_id: taskId,
      streaming: 'duplex',
    });
    upstream.on('open', () => {
      upstream.send(
        JSON.stringify({
          header: header('run-task'),
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: settings.model,
            parameters: {
              format: 'pcm',
              sample_rate: 16000,
              language_hints: [language],
              max_sentence_silence: 800,
              heartbeat: true,
            },
            input: {},
          },
        }),
      );
      // 一次性推入全部音频：分帧发送避免单帧过大。
      const CHUNK = 8192;
      for (let i = 0; i < pcm.length; i += CHUNK) {
        if (upstream.readyState !== WebSocket.OPEN) return;
        upstream.send(
          JSON.stringify({
            header: header('send-audio'),
            payload: { audio: pcm.subarray(i, i + CHUNK).toString('base64') },
          }),
        );
      }
      if (upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(
        JSON.stringify({
          header: header('finish-task'),
          payload: { input: {} },
        }),
      );
    });
    upstream.on('message', (data) => {
      if (done) return;
      try {
        const message = JSON.parse(data.toString()) as {
          header?: { task_id?: string; event?: string };
          payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } };
        };
        if (message.header?.task_id !== taskId) return;
        switch (message.header.event) {
          case 'task-started':
            began = true;
            break;
          case 'result-generated': {
            const sentence = message.payload?.output?.sentence;
            if (!sentence || typeof sentence.text !== 'string') return;
            if (sentence.sentence_end) sentences += sentence.text;
            else if (!sentence.text) return;
            break;
          }
          case 'task-finished':
            finish(undefined, sentences.trim());
            break;
          case 'error':
            finish(message.payload?.output?.sentence?.text ?? '阿里云识别出错。');
            break;
        }
      } catch {
        /* 忽略非 JSON 心跳等帧 */
      }
    });
    upstream.on('close', () => {
      if (began) finish(undefined, sentences.trim());
      else finish('阿里云识别连接中断，请检查配置后重试。');
    });
  });
}
