# 接入 DeepSeek AI 玩家

DeepSeek 玩家复用 `apps/agent/src/session.ts`，通过 OpenAI 官方 Node SDK 连接 `https://api.deepseek.com`，运行“观察 → JSON 动作决策 → 本地校验 → 世界服务执行 → 观察结果”循环。它不是 Voice Lab 的语音聊天提供商，也不是原有固定脚本 Scout。

## 配置与启动

在项目根目录现有 `.env` 中追加以下配置，保留已有数据库等设置。也可以通过环境变量传入；环境变量优先。不要提交 API Key，不要使用 `VITE_*`。

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek_API_Key
DEEPSEEK_MODEL=deepseek-flash
AGENT_NAME=DeepSeek
AGENT_GOAL=探索附近环境，用中文简短介绍你的观察，友好回应玩家。
AGENT_MAX_TURNS=20
AGENT_ALLOW_EDITS=false
```

启动最新代码的世界服务，再运行独立 Agent 进程。默认世界端口为 2567；当前浏览器 5187 对应的开发世界使用 2577：

若已有世界进程尚未加载这次修改，Agent 会在调用模型前提示更新服务并退出。本次没有重启正在使用的开发世界；当前 memory 模式重启会丢失方块编辑，须先备份/恢复或使用持久化配置。

```sh
SERVER_URL=ws://127.0.0.1:2577 pnpm agent:deepseek
```

顶部“玩家”面板将显示 AI 代理身份，模型每轮可以选择移动、聊天或等待。`Ctrl+C` 取消模型请求、停止移动并退出世界；达到轮数上限会自动退出。模型配置/认证/余额错误直接结束，其他连续三次失败也停止，不会无限重试。已有 Scout 命令 `pnpm agent` 保持不变。

DeepSeek API 需要有效 API Key 和账户可用额度。运行时会把 Agent 目标、附近方块、玩家昵称和近期公共聊天事件发送给 DeepSeek；没有浏览器音频、文件或环境变量读取工具。

## 思考模式

默认 `thinking: {type: "disabled"}`、每轮最多 512 输出 token，减少交互等待。与官方 SDK 示例相同的思考模式：

```dotenv
DEEPSEEK_THINKING=enabled
DEEPSEEK_REASONING_EFFORT=high
DEEPSEEK_MAX_TOKENS=4096
DEEPSEEK_TIMEOUT_MS=60000
```

未设置 `DEEPSEEK_MAX_TOKENS` 时，开启思考默认 4096，关闭默认 512。JSON 被截断或返回空内容时，该轮不会执行任何动作；可适当提高 token 上限或关闭思考。SDK 自动重试已关闭，每轮至多一次推理请求。

## 可执行动作和边界

- `wait`：等待下一次观察。
- `chat`：1–240 字公共消息。
- `move`：世界坐标方向 x/z 在 -1..1，跳跃布尔值，持续 100–1500ms；本地以 10Hz 发送输入，取消或结束后发送停止输入。
- `edit`：需显式设置 `AGENT_ALLOW_EDITS=true` 才允许放置/移除方块。使用观察时的世界版本，服务端继续检查距离、碰撞、基岩、边界和版本冲突。被拒绝的编辑不会自动重放。

默认 20 轮，`AGENT_MAX_TURNS` 范围 1–200；间隔 `AGENT_INTERVAL_MS` 默认 3000，范围 1000–60000。每次输入最多 500 个附近方块、16 个玩家、12 条最近事件和上轮动作结果。没有任意 shell、文件系统或网络工具。AI 身份与脚本身份一样只是显示标签，不授予额外权限；本机原型仍没有账户认证。

模型自主表现需用真实 Key 实测。自动化测试使用 OpenAI SDK 的模拟 HTTP 响应验证请求格式，并在独立临时世界验证移动、聊天、编辑及离开；这些测试不调用付费模型。

```sh
pnpm check
pnpm test:agent:deepseek  # 自动启动独立临时世界，不触碰正在玩的世界
```

接口依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode)。
