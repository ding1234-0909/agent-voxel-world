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

/**
 * 智能离线兜底：先按用户说的话匹配相关回应（接着话题聊），
 * 匹配不到时从用户的话里挑一个词"引用式"回应，让对话像真人聊天，
 * 实在没识别到内容才轮换预设短句。
 */
export function pickOfflineReply(userText: string, history: ChatMessage[]): TutorReply {
  const t = (userText || '').toLowerCase().replace(/[，。！？、,.!?'"（）()]/g, ' ');

  // 关键词规则：按用户问的内容回答（中英文都支持）
  const rules: Array<{ test: RegExp; en: string; zh: string }> = [
    { test: /(hi|hello|hey|good morning|good afternoon|你好|嗨|早上好)/, en: "Hello! Great to see you in our block world. What shall we do today?", zh: "你好！很高兴在方块世界见到你。我们今天做点什么？" },
    { test: /(how are you|how's it going|what's up|how r u|how are u|你好吗|最近怎么样)/, en: "I'm doing great, thanks for asking! I just finished building a bridge. How about you?", zh: "我很好，谢谢关心！我刚建好一座桥。你呢？" },
    { test: /(your name|who are you|你叫什么|你是谁)/, en: "My name is Builder, and this is the AI primary school. Nice to meet you!", zh: "我叫 Builder，这里是 AI 小学。很高兴认识你！" },
    { test: /(\d+|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b).*(year|years|old|岁)/, en: "Wow, that's a wonderful age to learn English! You'll get better every single day.", zh: "哇，这个年纪学英语刚刚好！你会一天比一天厉害的。" },
    { test: /(like|love|enjoy|favorite|favourite|喜欢|最爱).*(color|colour|red|blue|green|yellow|black|white|颜色)/, en: "Colors are so much fun! Red and blue are my favorites. What's your favorite color?", zh: "颜色真有趣！红色和蓝色是我的最爱。你最喜欢的颜色是什么？" },
    { test: /(like|love|enjoy|favorite|favourite|喜欢|最爱).*(animal|cat|dog|rabbit|panda|sheep|horse|动物|猫|狗|兔子)/, en: "Animals are my best friends! I think cats and dogs are wonderful. Which animal do you like best?", zh: "动物是我最好的朋友！我觉得小猫小狗都很棒。你最喜欢哪种动物？" },
    { test: /(build|building|house|castle|block|mine|建|盖|房子|城堡|方块)/, en: "Building is the best part of this world! Let's make a castle together. What blocks do you want to use?", zh: "建造是这个世界上最好玩的事！我们一起盖城堡吧。你想用什么方块？" },
    { test: /(school|study|learn|english|homework|teacher|学校|学习|英语|作业|老师)/, en: "This is the AI primary school, and learning English here is really fun! What did you learn at school today?", zh: "这里是 AI 小学，在这里学英语超好玩！你今天在学校学了什么？" },
    { test: /(eat|lunch|breakfast|dinner|food|apple|bread|milk|rice|hungry|吃|午饭|早饭|面包|牛奶|苹果|饿)/, en: "Yummy! Food always makes me happy. I love bread and milk. What food do you like?", zh: "好吃！美食总能让我开心。我喜欢面包和牛奶。你喜欢什么吃的？" },
    { test: /(play|game|jump|run|swim|ball|hide|seek|玩|游戏|跳|跑|游泳|球|捉迷藏)/, en: "Playing is the best! Let's play a game together. Can you jump three times?", zh: "玩是最棒的事！我们一起玩游戏吧。你能跳三下吗？" },
    { test: /(thank|thanks|great|good|awesome|nice|谢谢|太棒|真好)/, en: "You are very polite! Saying thank you makes the world warmer. Keep it up!", zh: "你真有礼貌！说谢谢让世界更温暖。继续保持！" },
    { test: /(yes|yeah|ok|okay|no|好|嗯|不)/, en: "Got it! You're doing great. Let's try one more sentence in English, okay?", zh: "明白啦！你做得很好。我们再用英语试一句好不好？" },
    { test: /(sing|song|music|dance|唱歌|音乐|跳舞)/, en: "I love music! Singing helps you learn English faster. Can you sing your favorite song for me?", zh: "我喜欢音乐！唱歌能让你更快学会英语。你能给我唱一首你最喜欢的歌吗？" },
    { test: /(story|book|read|故事|书|读)/, en: "Stories are full of magic! Can you tell me a short story in English? I love listening.", zh: "故事充满魔力！你能用英语给我讲一个小故事吗？我最爱听啦。" },
    { test: /(weather|sunny|rain|snow|cloud|天|晴|雨|雪|云)/, en: "Look at the sky! Do you like sunny days or rainy days? I like sunny days best.", zh: "看天空！你喜欢晴天还是雨天？我最喜欢晴天。" },
    { test: /(friend|friends|一起|朋友)/, en: "Friends make everything fun! In this world, you, me and the robots are good friends. Let's build together!", zh: "有朋友才好玩！在这个世界里，你、我和机器人们都是好朋友。我们一起建吧！" },
    { test: /(boring|tired|sad|不开心|无聊|累)/, en: "Don't worry! When you feel tired, let's take a break and build something fun together, okay?", zh: "别担心！累的时候我们就休息一下，一起建点好玩的东西，好吗？" },
  ];

  for (const r of rules) {
    if (r.test.test(t)) {
      const { en, zh } = r;
      return { en, zh, raw: `${en}（${zh}）` };
    }
  }

  // 引用式回应：从用户的话里挑最后一个英文单词，接着它聊，显得"听懂"了
  const words = (userText || '').match(/[a-zA-Z][a-zA-Z']{1,}/g) || [];
  const lastWord = words.length > 0 ? words[words.length - 1] : null;
  if (lastWord && lastWord.length >= 3) {
    const en = `You said "${lastWord}" — that's interesting! Can you use it in a full sentence, like "I like ${lastWord}"?`;
    const zh = `你说了 ${lastWord}——真有意思！你能用它造个完整的句子吗？比如"我喜欢 ${lastWord}"。`;
    return { en, zh, raw: `${en}（${zh}）` };
  }

  // 完全没识别到内容：轮换预设短句，避免一直重复
  const idx = (history.length || 0) % OFFLINE_TUTOR_PHRASES.length;
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

/** 先问服务端 AI 陪练（已内置 DeepSeek，无需在浏览器填任何密钥）。 */
async function fetchServerAiChat(text: string): Promise<TutorReply | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, session: 'ai-tutor' }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { en?: string; zh?: string };
    if (data.en) {
      return { en: data.en, zh: data.zh ?? '', raw: `${data.en}（${data.zh ?? ''}）` };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTutorChat(
  config: TutorConfig,
  history: ChatMessage[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TutorReply> {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';

  // 1. 优先走服务端 AI 陪练（已内置 DeepSeek 密钥，玩家无需任何配置）
  if (lastUser) {
    const serverReply = await fetchServerAiChat(lastUser);
    if (serverReply) return serverReply;
  }

  // 2. 服务端不可用时，若浏览器里填过自己的接口，则浏览器直连
  if (config.baseURL.trim() && config.apiKey.trim() && config.model.trim()) {

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
    // 网络错误 / 超时 / CORS 拦截 / 未联网：切换到智能离线兜底，伙伴照常说话
    return pickOfflineReply(lastUser, history);
  } finally {
    clearTimeout(timer);
  }
  }

  // 3. 服务端和浏览器都没配置接口：智能离线兜底（听懂你的话再回应）
  return pickOfflineReply(lastUser, history);
}
