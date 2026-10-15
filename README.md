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

## 操作

- 点击画面锁定鼠标；WASD 移动、Space 跳跃、鼠标转向，Esc 释放。
- 中央准星选择 6 格以内的方块；左键移除、右键放置。也可使用底部 Remove / Place block 按钮；点击材质卡选择方块。
- 地形碰撞、重力、速度、编辑距离、基岩保护、玩家占用、相邻支撑和版本冲突均由服务器校验。
- 聊天支持群聊、@ 私聊、语音转文字和语音消息；附近语音可独立开启麦克风与收听，按距离和朝向调节音量，并自动分段转写给附近玩家与 Agent。详见 [聊天与空间语音](docs/CHAT.md)。开启 Agent 的语音回复后，附近已开启收听的玩家可听到它的声音，私聊只对指定对象播放。玩家位置以 20Hz 权威更新，画面进行插值。
- 页面刷新自动使用当前标签页的昵称和重连令牌；异常断线 20 秒内可保留身份，超时或服务器重启则重新入房。
- Voice Lab 支持语音回声、Ollama 本地 AI 对话和文字 mock。默认使用本机 Whisper 识别，支持中文/英文、麦克风/音频文件、文字输入、朗读和打断；用 `pnpm voice:setup` 准备本地模型。无需 Google Cloud 账号或信用卡，详见 [语音配置](docs/VOICE.md)。

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
- `apps/agent`：显式标注的脚本测试 Agent、结构化 SDK、集成检查。
- DeepSeek AI 玩家：配置 `DEEPSEEK_API_KEY` 后运行 `pnpm agent:deepseek`，支持观察、移动、聊天和显式开启的方块编辑。使用 OpenAI 官方 SDK，支持 DeepSeek 思考模式；启动端口与配置见 [Agent 接入](docs/AGENT_PLAYERS.md)。
- `packages/shared`：协议、确定性地形、物理与校验。

## 范围和限制

这是本地单进程、单世界、最多 16 会话的原型，不是完整 Minecraft。地形 25×25、高度上限 15；没有背包、合成、战斗、账户鉴权、反作弊运营、多人分片或生产部署。方块编辑持久化，玩家位置、聊天、事件和语音会话暂不持久化。事件环形缓存保留最近 100 条，观察返回最近 30 条当前会话有权接收的事件。

Agent 观察是以自身为中心半径 8 的距离裁剪，最多 500 个最近方块，不做遮挡/视锥裁剪；这是结构化场景接口，并非模型视觉。Agent 与人类共用同一移动和编辑校验。Scout 脚本 Agent 没有 LLM；DeepSeek AI 玩家由模型决策，两者都没有额外管理权限。协议见 [接口文档](docs/PROTOCOL.md)。

语音方案已支持 `mock`、`browser` 和 `ollama`。回声不是 AI；Ollama 需预先安装并配置。语音识别默认由本机 Whisper 处理，浏览器在线识别可选，朗读是否联网取决于浏览器语音。尚未接入 Google Vertex 或其他付费云端音频模型。未来凭据必须放服务端环境，不能放 `VITE_*`。

### 在大厅创建 AI 玩家

点击 **控制台 → 模型服务商**，配置 DeepSeek、本机 Ollama 或 OpenAI 兼容接口；再到 **Agent 玩家** 选择服务商与模型，设置任务并点击 **创建并加入世界**。已有 DeepSeek 环境变量会在首次启动管理服务时导入。配置与创建分离，支持多个 Agent 独立运行、查看日志和停止。详见 [AI 玩家接入](docs/AGENT_PLAYERS.md)。
