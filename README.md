# Agent Voxel World

独立的本地多人 3D 体素原型：TypeScript · pnpm workspace · React/Vite · Three.js · Node/Colyseus · PostgreSQL/Prisma。

## 快速运行

环境要求：Node 22、pnpm 10、PostgreSQL 17 二进制。macOS 默认使用 `/opt/homebrew/opt/postgresql@17/bin`，其他路径通过 `PG_BIN` 指定。无需 Docker 或云账号。

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:start
pnpm db:migrate
pnpm dev
# 另一个终端：
pnpm agent
```

打开 http://127.0.0.1:5173 ，用两个独立浏览器上下文输入不同昵称进入。服务只绑定 `127.0.0.1:2567`。`pnpm db:start` 只在本项目 `.data/postgres` 初始化数据库，在端口 55432 启动，创建被 Git 忽略的 `.env`，绝不覆盖已有 `.env`。端口被占用或数据目录没有项目标记时拒绝启动。开发用凭据仅适用于本地测试。

停止前端/服务端用 Ctrl+C；停止独立数据库用 `pnpm db:stop`。再次 `pnpm db:start` 使用原数据。不要删除 `.data`，除非有意丢弃这个原型的世界。

如果没有 `DATABASE_URL`，服务器明确进入 `memory` 模式：刷新页面仍读取活跃房间，但服务重启会丢失编辑。配置了数据库但连接失败时，启动失败，绝不悄悄切成内存模式。

`pnpm dev` 不会自动启动数据库。后端会在监听端口前检查数据库连接及世界表，失败时显示中文原因和处理命令，不再输出重复的 Prisma 启动堆栈。若提示无法连接 `127.0.0.1:55432`，请手动运行 `pnpm db:start`，然后重启 `pnpm dev`；若提示表结构未准备好，请先确认数据库配置再运行 `pnpm db:migrate`。Vite 显示 `ready` 只表示前端就绪，后端启动失败时仍无法进入世界。未配置数据库时会明确警告内存模式不保留重启后的编辑。

## 操作

- 点击画面锁定鼠标；WASD 移动、Space 跳跃、鼠标转向，Esc 释放。
- 中央准星选择 6 格以内的方块；左键移除、右键放置。也可使用底部 Remove / Place block 按钮；点击材质卡选择方块。
- 地形碰撞、重力、速度、编辑距离、基岩保护、玩家占用、相邻支撑和版本冲突均由服务器校验。
- 聊天支持群聊、@ 私聊、语音转文字和语音消息；附近语音可独立开启麦克风与收听，按距离和朝向调节音量，并自动分段转写给附近玩家与 Agent。详见 [聊天与空间语音](docs/CHAT.md)。开启 Agent 的语音回复后，附近已开启收听的玩家可听到它的声音，私聊只对指定对象播放。玩家位置以 20Hz 权威更新，画面进行插值。
- 页面刷新自动使用当前标签页的昵称和重连令牌；异常断线 20 秒内可保留身份，超时或服务器重启则重新入房。
- 控制台的“文本转语音（TTS）”以左侧列表、右侧配置管理本机、百炼及兼容接口的音色，支持保存与试听。创建或编辑 Agent 时选择已保存服务，实际回复按所选音色发声；独立的“语音识别（ASR）”页面可检查并试用服务器上的自托管 Whisper 转写，聊天与附近语音沿用该识别能力。详见 [语音配置](docs/VOICE.md)。

## 验证

```sh
pnpm check             # 类型、规则和语音测试、所有应用构建
pnpm test:integration  # 需要已启动 PostgreSQL + 应用服务；会临时修改本地世界
pnpm format:check
```

集成测试启动两个 SDK 玩家和一个脚本 Agent，检查并发编辑仅一方成功、三方同步、非法动作拒绝、聊天、断线恢复、持久化模式及 mock 字幕打断。真实双浏览器和服务重启记录见 [验证记录](docs/VALIDATION.md)。测试默认修改 `(2,3,1)` 并最终移除该方块；请仅在本测试世界运行。

## 结构

- `apps/web`：React UI、Three.js 实例化体素、插值、重连。
- `apps/server`：Colyseus 单一权威世界、事务存储、语音 provider 接口。
- `apps/server/prisma`：PostgreSQL schema 和可重放迁移。
- `apps/agent`：Scout 与 DeepSeek CLI 入口、命令行配置、集成检查。
- `packages/agent-runtime`：CLI 与服务端共用的会话客户端、动作、模型规划和任务运行时，通过 `@voxel/agent-runtime` 引用。
- DeepSeek AI 玩家：配置 `DEEPSEEK_API_KEY` 后运行 `pnpm agent:deepseek`，支持观察、移动、聊天和显式开启的方块编辑。使用 OpenAI 官方 SDK，支持 DeepSeek 思考模式；启动端口与配置见 [Agent 接入](docs/AGENT_PLAYERS.md)。
- `packages/shared`：协议、确定性地形、物理与校验。

服务端按职责组织，`src/index.ts` 负责启动、依赖装配和关闭清理：

```text
apps/server/
├── prisma/                 # schema 与 migrations
├── src/
│   ├── index.ts
│   ├── routes/             # HTTP 路由及就近维护的路由测试
│   ├── world/              # 权威房间与世界持久化
│   ├── agent/              # Agent 管理与语音回复
│   ├── audio/              # 语音 provider、本地识别与合成
│   ├── realtime/           # 实时会话、百炼适配器与离线协议模拟器
│   └── chat/               # 消息分发与附件管理
└── test/
    ├── integration/        # 独立临时世界中的集成脚本
    └── sandbox/            # 独立沙盒启动入口
```

`pnpm test:voice:services`、`pnpm test:agents`、`pnpm test:chat`、`pnpm test:agent:voice`、`pnpm test:agent:tasks` 和 `pnpm test:agent:deepseek` 指向服务端集成脚本，使用隔离世界和固定模型响应。实时会话集成与沙盒命令见 [百炼实时语音](docs/ALIYUN_REALTIME.md)。这些脚本由 `tsx` 显式运行，不进入默认 Vitest 扫描；根目录 `pnpm test:integration` 仍是需要已启动服务的 Agent 客户端集成检查。

前端按功能与基础设施组织：

```text
apps/web/src/
├── main.tsx                # React 挂载与单个世界连接的热更新清理
├── App.tsx                 # 大厅、游戏场景与面板装配
├── features/
│   ├── console/            # 控制台、表单、任务卡片、状态控制器与 API
│   ├── chat/               # 消息、选人、录音草稿、状态控制器与 API
│   ├── voice/              # 语音面板、能力查询与实时语音样式
│   └── world/              # 在线玩家面板
├── graphics/               # Three.js 场景、角色与名称牌
├── audio/                  # 采集、播放、转写及 PCM Worklet
├── network/                # 服务地址、连接与在线状态订阅
└── styles/                 # 全局样式
```

功能的 HTTP 请求由对应 `api.ts` 管理；通用 HTTP/WebSocket 地址统一从 `network/endpoints.ts` 解析。音频基础设施保留自身的流处理与请求取消。组件不从录音模块获取服务地址，也不直接发起 HTTP 请求。单元测试可以就近维护，已有跨模块回归测试仍保留在根目录 `tests/`。

控制台状态由 `useConsoleController` 持有，表单和任务卡片通过参数与回调交互；语音面板在切换分类或关闭控制台时保持挂载。`useChatController` 管理选人、录音与发送状态，并在断线或卸载时清理采集与上传。`pcm-worklet.js` 与加载它的 `realtime-audio.ts` 同目录。开发、独立预览与根目录测试继续使用相对导入，不要求路径别名。

`output/`、`dist/` 和 `node_modules/` 不参与源码类型检查；历史临时验收文件不属于正式源码。

## 范围和限制

这是本地单进程、单世界、最多 16 会话的原型，不是完整 Minecraft。地形 25×25、高度上限 15；没有背包、合成、战斗、账户鉴权、反作弊运营、多人分片或生产部署。方块编辑持久化，玩家位置、聊天、事件和语音会话暂不持久化。事件环形缓存保留最近 100 条，观察返回最近 30 条当前会话有权接收的事件。

Agent 观察是以自身为中心半径 8 的距离裁剪，最多 500 个最近方块，不做遮挡/视锥裁剪；这是结构化场景接口，并非模型视觉。Agent 与人类共用同一移动和编辑校验。Scout 脚本 Agent 没有 LLM；DeepSeek AI 玩家由模型决策，两者都没有额外管理权限。协议见 [接口文档](docs/PROTOCOL.md)。

语音方案已支持 `mock`、`browser` 和 `ollama`。回声不是 AI；Ollama 需预先安装并配置。语音识别默认由本机 Whisper 处理，浏览器在线识别可选，朗读是否联网取决于浏览器语音。尚未接入 Google Vertex 或其他付费云端音频模型。未来凭据必须放服务端环境，不能放 `VITE_*`。

### 在大厅创建 AI 玩家

点击 **控制台 → 模型服务商**，配置 DeepSeek、本机 Ollama 或 OpenAI 兼容接口；再到 **Agent 玩家** 选择服务商与模型，设置任务并点击 **创建并加入世界**。已有 DeepSeek 环境变量会在首次启动管理服务时导入。Agent 每次推理可规划最多 8 个顺序动作，逐步观察，失败停止；按任务进展自主继续或停止，普通消息在动作边界插入，空闲不调用模型。支持固定/随机轮询、任务暂停/继续/取消、进度与 token 用量，以及高级预算保护。详见 [AI 玩家接入](docs/AGENT_PLAYERS.md)。
