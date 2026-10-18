import type { ChatMessage, TutorConfig } from './types';

/**
 * OpenAI 兼容接口直连（参考原版 index.html 第 3792-3800 行 API_CONFIG、
 * 第 3890-3935 行 fetch 调用）。纯前端请求，不经过项目后端；
 * 若服务商未开放 CORS，浏览器会拦截，需用户自行确认服务商支持。
 */

/** 原版 Builder 人设 system prompt（源码 3798 行，原样沿用）。 */
export const TUTOR_SYSTEM_PROMPT =
  '你是一个友好的AI英语陪练伙伴，名字叫Builder，住在一个方块世界里。用户是小学生，在学英语。请用英语回答，回答要简短有趣（1-3句话），然后在后面用括号附上中文翻译。鼓励用户说英语，纠正语法错误，偶尔教新单词。';

export interface TutorReply {
  /** 去掉括号中文后的英文正文。 */
  en: string;
  /** 括号内的中文翻译（可能为空）。 */
  zh: string;
  /** 模型返回的原始完整文本。 */
  raw: string;
}

export class TutorError extends Error {}

const DEFAULT_TIMEOUT_MS = 20000;

/** 把 baseURL 规整为去掉尾部斜杠的根地址，再拼接 /chat/completions。 */
export function buildEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  return `${trimmed}/chat/completions`;
}

/**
 * 分离模型回复末尾括号里的中文翻译（源码 3912-3915 行正则）。
 * 兼容中英文括号：(中文) / （中文）。
 */
export function splitTranslation(raw: string): { en: string; zh: string } {
  const match = raw.match(/^([\s\S]*?)[（(]([\s\S]*?)[）)]\s*$/);
  if (match) return { en: match[1].trim(), zh: match[2].trim() };
  return { en: raw.trim(), zh: '' };
}

export async function sendTutorChat(
  config: TutorConfig,
  history: ChatMessage[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TutorReply> {
  if (!config.baseURL.trim() || !config.apiKey.trim() || !config.model.trim()) {
    throw new TutorError('未完成配置：请先点击右上角 ⚙ 设置，填写接口地址、API Key 和模型名。');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildEndpoint(config.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [
          { role: 'system', content: TUTOR_SYSTEM_PROMPT },
          ...history,
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new TutorError('API Key 无效或未授权（401），请检查设置中的 Key 是否正确。');
    }
    if (response.status === 404) {
      throw new TutorError('接口地址不存在（404），请检查 baseURL 是否为 OpenAI 兼容接口根地址（通常以 /v1 结尾）。');
    }
    if (!response.ok) {
      throw new TutorError(`请求失败（HTTP ${response.status}），请检查接口地址与网络后重试。`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new TutorError('接口返回格式异常，未找到回复内容（choices[0].message.content 为空）。');
    }

    const { en, zh } = splitTranslation(raw);
    return { en, zh, raw: raw.trim() };
  } catch (error) {
    if (error instanceof TutorError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TutorError('请求超时（20 秒无响应），请检查网络或接口是否可用。');
    }
    // TypeError: Failed to fetch —— 网络错误或 CORS 被拦截
    throw new TutorError('网络错误或被浏览器 CORS 拦截：请确认服务商允许跨域访问，且接口地址可直接访问。');
  } finally {
    clearTimeout(timer);
  }
}
