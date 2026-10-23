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

/** 离线兜底：不联网也能练口语的预设英文短句（初一初二水平，带中文翻译）。 */
export const OFFLINE_TUTOR_PHRASES: Array<{ en: string; zh: string }> = [
  { en: "Hello! Welcome back to our block world. How are you today?", zh: "你好！欢迎回到我们的方块世界。你今天过得怎么样？" },
  { en: "Let's build a big castle together. What color do you like?", zh: "我们一起建一座大城堡吧。你喜欢什么颜色？" },
  { en: "Look at the sky! Do you like sunny days or rainy days?", zh: "看天空！你喜欢晴天还是雨天？" },
  { en: "Can you say 'apple' after me? A - p - p - l - e!", zh: "跟我念 apple 好吗？A - p - p - l - e！" },
  { en: "I see a cute sheep over there. Can you count how many sheep there are?", zh: "我看到那边有一只可爱的小羊。你能数数有几只羊吗？" },
  { en: "Nice to meet you! My name is Builder. What's your name?", zh: "很高兴认识你！我叫 Builder。你叫什么名字？" },
  { en: "Let's jump three times! One, two, three! Great job!", zh: "我们跳三下！一、二、三！做得真棒！" },
  { en: "What do you want to eat for lunch? I like bread and milk.", zh: "你午饭想吃什么？我喜欢面包和牛奶。" },
  { en: "The mountain is very high. We can climb it together. Let's go!", zh: "那座山很高。我们可以一起爬上去。走吧！" },
  { en: "Tell me about your school. Do you like your teacher?", zh: "跟我讲讲你的学校吧。你喜欢你的老师吗？" },
  { en: "I love music! Can you sing a song for me?", zh: "我喜欢音乐！你能为我唱首歌吗？" },
  { en: "What's your favorite animal? I really like rabbits.", zh: "你最喜欢的动物是什么？我非常喜欢兔子。" },
  { en: "Let's play hide and seek. You hide, and I will find you!", zh: "我们玩捉迷藏吧。你藏起来，我来找你！" },
  { en: "Do you want to go swimming? The water is very cool today.", zh: "你想去游泳吗？今天水很凉快。" },
  { en: "Great job today! You learned so many new words. See you tomorrow!", zh: "今天表现得真棒！你学到了很多新单词。明天见！" },
  { en: "This is the AI primary school. Let's learn English and have fun together!", zh: "这里是 AI 小学。我们一起学英语、一起开心！" },
  { en: "Can you tell me a story? I love listening to stories.", zh: "你能给我讲个故事吗？我最喜欢听故事了。" },
  { en: "Let's draw a picture. I will draw a big tree. What will you draw?", zh: "我们来画画吧。我要画一棵大树。你想画什么？" },
  { en: "Breakfast is ready! Let's eat eggs and drink some milk.", zh: "早餐准备好啦！我们吃鸡蛋、喝牛奶吧。" },
  { en: "Remember to say 'please' and 'thank you'. You are very polite!", zh: "记得说 please 和 thank you。你真有礼貌！" },
];

/** 根据历史轮换选择一条兜底短句（避免一直重复同一句）。 */
export function pickOfflineReply(historyLength: number): TutorReply {
  const idx = historyLength % OFFLINE_TUTOR_PHRASES.length;
  const { en, zh } = OFFLINE_TUTOR_PHRASES[idx];
  return { en, zh, raw: `${en}（${zh}）` };
}

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
    // 未配置 AI 接口时，使用离线陪练兜底（不联网也能练口语）
    return pickOfflineReply(history.length);
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
    // 网络错误 / 超时 / CORS 拦截 / 未联网：切换到离线陪练兜底，伙伴照常说话
    return pickOfflineReply(history.length);
  } finally {
    clearTimeout(timer);
  }
}
