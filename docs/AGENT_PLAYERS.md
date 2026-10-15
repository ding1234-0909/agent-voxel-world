# 接入 AI 玩家

DeepSeek 玩家复用 `apps/agent/src/session.ts`，通过 OpenAI 官方 Node SDK 连接 `https://api.deepseek.com`，运行“观察 → JSON 动作决策 → 本地校验 → 世界服务执行 → 观察结果”循环。它不是 Voice Lab 的语音聊天提供商，也不是原有固定脚本 Scout。

## 大厅控制台（推荐）

### 连续建造

开启“允许放置 / 移除方块”后，所有服务商的 Agent 都支持一次推理规划多块建造：

- `house`：用最小角坐标、宽深高、材质和门方向描述一座基础房屋，本地生成地板、空心墙壁、两格高门洞和平顶。宽/深 3–7 格，总高度 4–6 格；单个蓝图最多 192 块。
- `build`：一次提交 1–64 个具体方块修改，适合自定义结构、修补和拆除。坐标不能重复。
- 批次内约每 125 毫秒执行一块（上限约 8 块/秒，实际还取决于服务器响应），无需逐块推理或等待轮询间隔。每块等待服务器确认，沿用版本号、6 格距离、支撑、玩家占位等校验。
- 已存在且材质相同的方块会跳过；不同材质不会自动覆盖。房屋内部/门洞发现已有方块时，先报告障碍，不自动清理地形。中途停止不会回滚已完成方块。
- 遇到超距或障碍，返回完成数量、剩余坐标与失败原因。未完成蓝图保留到后续回合；模型需要移动站位或调整蓝图后继续，施工器不自动寻路。房屋应放在已观察到的空地上。

可以设置目标：“在附近空地使用 house 蓝图建造一座 3×3 小木屋，留出门洞；遇到超距先移动，再继续未完成蓝图，完成后报告结果。”一座 3×3×4 小屋包含 32 块，能由一次模型规划驱动，而非每块调用一次模型。较复杂的大房屋可以分段建造。

控制台运行记录会显示建造开始、阶段进度和完成/未完成数量。修改后需重载 Agent 服务，再创建新的 Agent；运行中的旧进程不会热替换施工逻辑。

无需先进入游戏。点击大厅中央的 **创建 Agent 玩家 / 配置模型**，或右上角 **Agent 管理**。

1. 在 **模型服务商** 中添加或编辑 DeepSeek、本机 Ollama、OpenAI 兼容服务。填写 API Base URL、默认模型和 API Key；本机 Ollama 不需要密钥。
2. 保存后切换到 **Agent 玩家**，选择服务商，点击 **测试连接 / 获取模型列表**，选择或手动填写模型 ID。这个按钮只读取模型列表，不执行推理；不提供模型列表接口的网关仍可手动填写。
3. 设置昵称、目标和推理参数。运行方式可选 **限定轮数** 或 **持续运行（永久）**；轮询可选 **固定间隔** 或 **随机区间**（默认 4000–8000 毫秒）。每轮推理和动作结束后再等待，随机模式每轮重新抽取时间，不并发推理。DeepSeek 支持开关思考模式、推理强度和输出 token 上限。方块修改默认关闭。
4. 点击 **创建并加入世界**。Agent 以 `ai-agent` 身份加入同一个世界，玩家列表与在线代理数量实时更新。右侧显示状态和运行记录，可随时停止。

最多同时在线 4 个由控制台管理的 Agent（含待命）；不同 Agent 可以使用不同服务商/模型。限定轮数结束后进入 **在线待命**，保留角色、位置、配置和运行记录，不再调用模型。点击 **继续运行** 再执行一批相同轮数，沿用当前会话的上下文和未完成蓝图；点击 **更换任务** 可输入新目标，用同一个角色执行，新目标会重置上一任务的推理上下文。持续模式一直执行，直到关闭或任务异常。

只有 **关闭 Agent** 才主动取消等待和推理并离开世界；关闭面板、退出真人游戏都不会关闭 Agent。任务异常会停止推理，已连接角色仍留在世界，允许重试；网络断开则显示异常，可用同一记录重新加入。关闭后的记录也可点击 **重新加入并运行** 复用配置，重新加入会产生新的游戏会话和出生位置。

Agent 记录保存在 `.data/agent-providers.json.agents.json`，权限 `0600`，不包含 API Key。服务重启后，原先在线的 Agent 自动重新加入并待命，不自动调用模型；之前明确关闭的 Agent 保持关闭。游戏会话、位置及临时推理上下文不会跨服务重启保留，场景方块是否持久化取决于世界存储配置。最多保存 50 条记录，达到上限时仅清理已关闭的旧记录。旧的命令行 Agent 仍独立管理，其限定轮数结束后退出的行为不变。

服务商保存在本机 `.data/agent-providers.json`（文件权限 `0600`，未加密，请勿分享或提交）。首次启动自动导入 `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `OLLAMA_MODEL`；已有配置文件后以控制台保存值为准，修改 `.env` 不会覆盖它。页面仅收到 `hasApiKey` 状态；编辑时留空保留密钥。更换地址域名或服务类型必须重新填写密钥。删除服务商不会删除世界方块。

通用服务必须兼容 OpenAI **Chat Completions** 和模型的 JSON 动作输出，原生 Anthropic/Responses 等接口尚未接入。可在兼容设置中关闭 `response_format`，或选择 `max_completion_tokens`。DeepSeek 专用思考字段不会发给其他服务商。本机 Ollama 使用 `http://127.0.0.1:11434/v1`，先在 Ollama 下载模型，再获取列表；配置 Ollama 失败不影响使用 DeepSeek。[Ollama 官方兼容接口说明](https://docs.ollama.com/api/openai-compatibility)。

管理 API 仅接受 `WEB_ORIGIN` 指定页面的 Origin，世界服务仍只绑定本机。`GET /agents/providers` 返回脱敏配置，`POST/PUT/DELETE /agents/providers[/id]` 管理服务商，已有可复用 Agent 关联的服务商不能删除。`GET /agents/providers/:id/models` 查询模型，`GET/POST /agents` 查看/创建玩家，`POST /agents/:id/resume` 继续运行（可传 `goal` 更换任务），`POST /agents/:id/stop` 关闭并离开。写请求使用 JSON。它是本机原型的管理接口，不应直接暴露到公网。

## DeepSeek 命令行（仍可使用）

### 配置与启动

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

当前 memory 模式在普通重启时会丢失方块编辑；更新运行中的世界前须先备份/恢复，或使用数据库持久化配置。

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

默认 20 轮，`AGENT_MAX_TURNS` 范围 1–200；设 `AGENT_CONTINUOUS=true` 可持续运行，直到 Ctrl+C、服务关闭或终止错误。间隔 `AGENT_INTERVAL_MS` 默认 3000，范围 1000–60000。命令行随机间隔示例：

```dotenv
AGENT_CONTINUOUS=true
AGENT_INTERVAL_MODE=random
AGENT_INTERVAL_MIN_MS=4000
AGENT_INTERVAL_MAX_MS=8000
```

随机上下限均为 1000–60000 的整数，下限不得大于上限，相等时为固定等待时间。省略 `AGENT_INTERVAL_MODE` 时保持 `fixed`。持续运行不代表跨服务重启恢复，云端调用会持续产生用量。运行记录及会话事件只保留有限条历史，避免长期运行时无界增长。

每次输入最多 500 个附近方块、16 个玩家、12 条最近事件和上轮动作结果。没有任意 shell、文件系统或网络工具。AI 身份与脚本身份一样只是显示标签，不授予额外权限；本机原型仍没有账户认证。

模型自主表现需用真实 Key 实测。自动化测试使用 OpenAI SDK 的模拟 HTTP 响应验证请求格式，并在独立临时世界验证移动、聊天、编辑及离开；这些测试不调用付费模型。

```sh
pnpm check
pnpm test:agent:deepseek  # 自动启动独立临时世界，不触碰正在玩的世界
pnpm test:agents          # 多服务商管理、Origin 校验、密钥脱敏、并发/停止/清理
```

接口依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode)。
