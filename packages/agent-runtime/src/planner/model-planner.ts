import OpenAI from 'openai';
import type {
  AgentConfig,
  AgentDecision,
  ModelEndpoint,
  Observation,
  Planner,
} from '../contracts';
import { AgentRuntimeError } from '../errors';
import { parseDecision } from './decision';
import { buildMessages } from './prompts';

const deepseekEndpoint: ModelEndpoint = {
  type: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  jsonMode: true,
  tokenField: 'max_tokens',
};

export async function listModels(
  endpoint: ModelEndpoint,
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const client = new OpenAI({
    baseURL: endpoint.baseUrl,
    apiKey: apiKey || 'ollama',
    maxRetries: 0,
    timeout: 10000,
    fetch: request,
    fetchOptions: { redirect: 'error' },
  });
  const page = await client.models.list();
  return [
    ...new Set(
      page.data.map((m) => m.id).filter((id) => typeof id === 'string'),
    ),
  ]
    .slice(0, 200)
    .sort();
}

export class ModelPlanner implements Planner {
  private client: OpenAI;
  lastUsage?: { tokens: number; estimated: boolean };
  constructor(
    private config: AgentConfig,
    request: typeof fetch = fetch,
    private endpoint: ModelEndpoint = deepseekEndpoint,
  ) {
    this.client = new OpenAI({
      baseURL: endpoint.baseUrl,
      apiKey: config.apiKey || 'ollama',
      maxRetries: 0,
      timeout: config.timeoutMs,
      fetch: request,
      fetchOptions: { redirect: 'error' },
    });
  }
  async decide(
    observation: Observation,
    previous: unknown,
    signal: AbortSignal,
  ): Promise<AgentDecision> {
    this.lastUsage = undefined;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      // DeepSeek's thinking field extends the OpenAI-compatible request schema.
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        thinking?: { type: 'enabled' | 'disabled' };
      } = {
        model: this.config.model,
        stream: false,
        ...(this.endpoint.type === 'deepseek'
          ? { thinking: { type: this.config.thinking } }
          : {}),
        ...(this.endpoint.type === 'deepseek' &&
        this.config.thinking === 'enabled'
          ? { reasoning_effort: this.config.reasoningEffort }
          : {}),
        ...(this.endpoint.jsonMode
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        [this.endpoint.tokenField]: this.config.maxTokens,
        messages: buildMessages(observation, previous, this.config),
      };
      this.lastUsage = {
        tokens:
          Math.ceil(JSON.stringify(body.messages).length / 2) +
          this.config.maxTokens,
        estimated: true,
      };
      const data = await this.client.chat.completions.create(body, {
        signal: combined,
      });
      if (
        Number.isFinite(data.usage?.total_tokens) &&
        data.usage!.total_tokens >= 0
      )
        this.lastUsage = { tokens: data.usage!.total_tokens, estimated: false };
      combined.throwIfAborted();
      const choice = data.choices?.[0];
      if (
        choice?.finish_reason !== 'stop' ||
        typeof choice.message?.content !== 'string' ||
        !choice.message.content.trim()
      )
        throw new AgentRuntimeError('模型未返回完整 JSON 动作，本轮跳过。');
      let value: unknown;
      try {
        value = JSON.parse(choice.message.content);
      } catch {
        throw new AgentRuntimeError('模型返回的 JSON 无法解析，本轮跳过。');
      }
      try {
        return parseDecision(value, this.config.allowEdits);
      } catch (error) {
        throw new AgentRuntimeError(
          `模型返回格式无效：${error instanceof Error ? error.message : '决策无法解析。'}本次未执行。`,
        );
      }
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      if (signal.aborted) throw new AgentRuntimeError('Agent 已停止。', true);
      if (timeout.signal.aborted)
        throw new AgentRuntimeError('模型请求超时，本轮跳过。');
      if (error instanceof OpenAI.APIError && error.status) {
        const reasons: Record<number, string> = {
          400: '请求或模型配置不受支持',
          401: 'API Key 无效',
          402: '账户余额不足',
          403: '访问被拒绝',
          404: '模型或接口不存在',
          429: '请求频率受限',
        };
        throw new AgentRuntimeError(
          `${this.endpoint.type === 'deepseek' ? 'DeepSeek' : '模型服务'} HTTP ${error.status}：${reasons[error.status] ?? '服务暂不可用'}。`,
          [400, 401, 402, 403, 404, 422].includes(error.status),
        );
      }
      // Never print remote response bodies, authorization headers, or request errors.
      throw new AgentRuntimeError('无法获得有效的模型动作，本轮跳过。');
    } finally {
      clearTimeout(timer);
    }
  }
}
