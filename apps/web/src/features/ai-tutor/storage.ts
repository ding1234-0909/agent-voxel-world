import type { ChatMessage, TutorConfig } from './types';

/**
 * 本地持久化（参考原版 index.html 第 3801-3812 行 AI_HISTORY_KEY /
 * loadAiHistory / saveAiHistory）。配置与多轮对话都存 localStorage，
 * 跨会话/刷新保留；对话最多保留最近 20 轮。
 */

const CONFIG_KEY = 'mcAiTutorConfig';
const HISTORY_KEY = 'mcAiHistory';
export const MAX_HISTORY = 20;

/** 默认走 DeepSeek 的 OpenAI 兼容接口；apiKey 由本机浏览器保存，不入库。 */
export const DEFAULT_TUTOR_CONFIG = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
} as const;

export function loadConfig(): TutorConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_TUTOR_CONFIG };
    const parsed = JSON.parse(raw) as Partial<TutorConfig>;
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : DEFAULT_TUTOR_CONFIG.baseURL,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_TUTOR_CONFIG.model,
    };
  } catch {
    return { ...DEFAULT_TUTOR_CONFIG };
  }
}

export function saveConfig(config: TutorConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* 隐私模式/存储满时静默失败 */
  }
}

export function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string',
      )
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveHistory(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(messages.slice(-MAX_HISTORY)),
    );
  } catch {
    /* 忽略写入失败 */
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* 忽略 */
  }
}
