/** AI 英语陪练：共享类型（OpenAI 兼容消息格式）。 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 用户在设置面板填写的 OpenAI 兼容接口配置。 */
export interface TutorConfig {
  /** OpenAI 兼容接口根地址，例如 https://api.openai.com/v1 */
  baseURL: string;
  /** API Key（Bearer Token），仅存于本机 localStorage。 */
  apiKey: string;
  /** 模型名称，例如 gpt-3.5-turbo / gpt-4o-mini。 */
  model: string;
}
