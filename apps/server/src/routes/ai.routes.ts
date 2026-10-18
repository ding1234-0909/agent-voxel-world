import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { ProviderStore } from '../agent/manager';

/**
 * /ai/chat — oral-practice companion chat.
 * Takes the player's spoken or typed English text, asks DeepSeek (the
 * configured cloud provider) for a short natural English reply plus a Chinese
 * translation, and returns { en, zh }. A per-session rolling history makes the
 * companions remember earlier turns, so conversations feel alive instead of
 * stateless. No client setup is needed: the provider was configured once on
 * the server and everything else is automatic.
 */

type Turn = { role: 'user' | 'assistant'; content: string };
const sessions = new Map<string, Turn[]>();
const SESSION_CAP = 12; // keep the last ~6 exchanges per player
const SYSTEM_PROMPT =
  'You are a friendly Minecraft friend chatting with the player, like a real ' +
  'buddy who talks casually about whatever comes to mind. ' +
  'Use natural everyday English at about Grade 7-8 (初一初二) level: full ' +
  'sentences of 8 to 18 words, simple grammar, common words, and a little ' +
  'variety in vocabulary. Feel free to ask the player questions, react to what ' +
  'they said, and drift naturally between topics (building, nature, school, ' +
  'food, games, weather). Never repeat a sentence you already said and never ' +
  'echo back what the player just typed. ' +
  'Then give an accurate, natural Chinese translation of that same sentence. ' +
  'ALWAYS respond in the SAME JSON format you used in your previous messages: ' +
  '{"en": "...", "zh": "..."}. Nothing else.';

/**
 * Parse the model reply: try JSON first, then fall back to splitting raw text
 * into an English part and a Chinese part (the model sometimes drifts into
 * plain text on later turns).
 */
function parseReply(content: string): { en: string; zh: string } | null {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      const en = String(obj.en ?? '').trim();
      if (en) return { en, zh: String(obj.zh ?? '').trim() };
    }
  } catch {
    /* fall through */
  }
  // Plain-text fallback: everything before the first CJK char is English,
  // the rest is the Chinese translation.
  const zhMatch = content.match(/[\u4e00-\u9fff][\s\S]*/);
  const zh = zhMatch?.[0]?.trim() ?? '';
  const en = zh ? content.slice(0, content.indexOf(zhMatch![0])).trim() : content.trim();
  return en ? { en: en.slice(0, 300), zh: zh.slice(0, 300) } : null;
}

export function installAiChatRoutes(app: Express, providers: ProviderStore) {
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
    };

  app.post(
    '/ai/chat',
    express.json({ limit: '32kb' }),
    route(async (req, res) => {
      const text = String(req.body?.text ?? '')
        .trim()
        .slice(0, 500);
      const session = String(req.body?.session ?? 'default')
        .trim()
        .slice(0, 64);
      if (!text)
        return res.status(400).json({ error: '请说点什么。' });
      const provider = providers.get('deepseek');
      if (!provider?.apiKey)
        return res.status(503).json({ error: '未配置模型服务，请先添加 API Key。' });
      if (!provider.baseUrl.startsWith('https://'))
        return res.status(503).json({ error: '模型服务地址无效。' });

      // Rolling per-session memory.
      const history = sessions.get(session) ?? [];
      const messages = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        ...history,
        { role: 'user' as const, content: text },
      ];

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.defaultModel || 'deepseek-chat',
          messages,
          max_tokens: 220,
          temperature: 0.7,
        }),
      });
      if (!response.ok) {
        return res
          .status(502)
          .json({ error: `模型服务返回 HTTP ${response.status}。` });
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      const parsed = parseReply(content);
      if (!parsed)
        return res.status(502).json({ error: '模型回复格式无效。' });

      // Remember this exchange, dropping the oldest turns. The assistant turn
      // is stored as JSON so the model keeps replying in the same format.
      history.push({ role: 'user', content: text });
      history.push({
        role: 'assistant',
        content: JSON.stringify(parsed),
      });
      if (history.length > SESSION_CAP)
        sessions.set(session, history.slice(history.length - SESSION_CAP));
      else sessions.set(session, history);

      res.json({
        en: parsed.en.slice(0, 300),
        zh: (parsed.zh || '').slice(0, 300),
      });
    }),
  );
}
