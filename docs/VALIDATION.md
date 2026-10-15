# 验证记录

执行日期：2026-10-15。位置：`/Users/yangshiming/code/own/agent-voxel-world`。本机 Node v22.23.1、pnpm 10.6.2、PostgreSQL 17.5。

## 已通过

- `pnpm check`：TypeScript 检查、7 项单元测试、4 个工作区包构建通过。生产输出按 React、Three.js、网络库分包，当前无 500KB chunk 警告。
- `pnpm test:integration`：9 组验收通过。两个 SDK 玩家与一个脚本 Agent 同场；结构化观察；白名单、非法移动、基岩与距离校验；并发编辑 CAS 及三方广播；聊天；异常 socket 重连保持 sessionId；新会话获取存储世界；mock 字幕、打断及会话隔离；权威限速移动。
- 真实浏览器：两个独立 Playwright 浏览器会话 voxel-a / voxel-b，另有持续脚本 Agent。浏览器显示三名在线玩家，Agent 观察日志报告 nearbyPlayers=3。
- Bob 通过页面 Place block 放置 `(0,3,-5)` 木块，刷新后自动恢复连接，仍可在画面准星命中该木块，世界版本为 24。
- PostgreSQL 只读查询确认 World(meadow).revision=24，BlockEdit 包含 `(0,3,-5,wood)`；这不是内存模式。
- 浏览器 Voice Lab 点击 Simulate 后立即 Interrupt，等待 2.1 秒，断言状态仍为 interrupted，通过。
- 服务器开发进程重启后，Agent 遇到观察超时，自动重新加入；新 sessionId 的观察日志仍报告 revision=24。
- 服务器重启后两个浏览器均恢复连接。Bob 的自动断言确认版本 24 恢复，并保存 `output/playwright/persisted-world.png`。后续世界继续编辑，版本已超过 24；追加断言使用“版本不倒退 + connected + postgresql”，通过。
- `git diff --check` 和 `pnpm format:check` 通过。

截图保存在被忽略的 `output/playwright/world.png`。原始浏览器快照保存在被忽略的 `.playwright-cli/`，避免将临时会话数据纳入版本库。

## 验证边界

- 浏览器测试启动器一度等待较久；最终命令成功返回，随后通过已安装的官方 Playwright CLI 复核。
- 未调用真实语音、麦克风、Google Vertex 或任何付费 AI。
- 尚未进行跨设备/公网、多进程扩容、16 人负载、长时间压力测试或真实网络丢包模拟。
- 数据库宕机事务失败路径已实现，尚未单独进行停库故障注入。

## 本地阶段提交

- `c330038` 骨架、独立 Git 与测试基线。
- `ebab1c3` 3D 体素、权威多人、规则测试。随后在真实浏览器发现 Schema 类字段配置问题，已在下一阶段修复。
- `d98b1dc` PostgreSQL、迁移、事务版本、Schema 配置修复。
- `b2cf9a3` 测试 Agent SDK 与三客户端集成测试。
- `47956ef` 服务端语音 mock、字幕和打断。
- `684c9cc` 重连完善、统一格式和运行/协议/验收文档。

没有远程推送、公开部署或全局 Git 配置修改。依赖安装最初遇到官方 npm Prisma 压缩包 ECONNRESET，重试成功。

## 2026-10-15：无需云账号的语音方案

- `pnpm check`：类型检查、4 个测试文件共 23 项测试、所有应用构建通过。
- `pnpm format:check` 与 `git diff --check` 通过。
- 使用独立内存服务（2577）和前端（5187，`WEB_ORIGIN` 指定对应地址）运行真实 Chromium 页面检查：进入世界、文字输入的浏览器回声、Ollama 未配置提示、切换 Mock 后的字幕、打断及切回浏览器方案均通过。截图：`output/playwright/voice-options.png`（本地测试产物，不入库）。
- 本次页面检查关闭自动朗读，没有采集真实麦克风；识别和播放的取消、权限错误等由自动化替身验证。
- 本机未检测到 Ollama，因此本地模型接口使用受控响应测试；尚未完成真实模型生成或真实声音的端到端验证。此前世界与数据库检查见上文，本次未重新执行数据库集成测试。

## 2026-10-15：本机 Whisper 修复在线识别失败

- `pnpm check`、`pnpm format:check`、`git diff --check` 通过：7 个测试文件、40 项测试、类型检查和全部应用构建。
- 本机已安装 whisper-cli / ffmpeg；下载并校验官方多语言 base 模型，SHA-256 为 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`，大小 147951465 字节；模型位于忽略目录 `.data/voice`。
- 真实 HTTP 接口：官方 JFK 英文 WAV 与转码 WebM 均成功返回完整句子 “And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.”。
- 中文真实模型测试：用系统 Tingting 生成测试音频，输入“你好，欢迎来到体素世界。今天我们一起建造一座房子。”，识别为“你好,欢迎来到体肃世界,今天我们一起建造一座房子。”。转写可用，但 base 模型存在“素/肃”同音字误差，不能等同于逐字正确。
- 真实页面通过文件选择入口上传官方 WAV，实际本机识别结果自动填入输入框并收到非 AI 回声。WebM 文件在浏览器被标为 video/webm 时，客户端按已知扩展名规范化音频类型。
- 未实际采集用户麦克风，未接受新的麦克风权限；录音、结束、取消、权限延迟、迟到结果、20 秒上限等由自动化替身验证。真实音频文件验证和真实设备麦克风验证是不同证据。
- 测试预览继续运行于 5187 / 2577，服务为 memory 模式；本次服务重载会重置临时世界，未操作持久数据库。

## 2026-10-15：大厅实时玩家面板

- `pnpm check` 通过：10 个测试文件、51 项测试、类型检查和全部应用构建。新增覆盖 SSE 初始快照、位置/连接状态/离开推送、Origin 限制、世界不可用、客户端心跳超时、HTTP 失败重试、旧流迟到消息和卸载清理。
- `pnpm format:check`、`git diff --check` 通过。
- 真实浏览器：大厅保持未加入状态，独立标签页加入“同步验证玩家”后在线人数从 1 变为 2，名单出现该玩家；玩家自己的标签页显示“你”。退出后大厅恢复为 1，退出的标签页继续订阅，不会清空其他玩家。截图：`output/playwright/live-players.jpg`。
- 真实本机 SDK + SSE：临时脚本代理加入、身份区分、移动位置变化、异常 socket 断线的 connected=false、原令牌恢复、主动退出后从名单删除均通过。大厅订阅不增加玩家名额，测试结束移除临时会话。
- 更新服务前将内存世界备份至忽略目录 `.data/world-before-presence.json`，开发服务启动日志确认恢复版本 26、2089 个方块。随后其他会话继续编辑至版本 87；最初对旧备份的固定版本相等断言因此失效，改为验证当前版本不倒退并重新通过。没有把旧备份再次覆盖到版本 87 上。此恢复是本次开发的一次性操作，不代表 memory 模式已实现持久化。
- 本次未重跑 PostgreSQL 集成测试、真实麦克风测试或 16 人负载测试。

## 2026-10-15：DeepSeek AI 玩家与 OpenAI SDK

- 安装 OpenAI 官方 Node SDK 7.34.0，仅用于 Agent 进程。DeepSeek 请求使用官方 baseURL、`deepseek-flash`、JSON 输出、非流式返回；思考开关和推理强度支持环境配置。
- `pnpm check`：11 个文件、74 项测试、类型检查和全部构建通过；`pnpm format:check`、`git diff --check` 通过。新增 23 项测试覆盖 SDK 实际请求格式、enabled/high 参数、输入校验、权限、超时取消、错误脱敏、轮数上限和失败停止。
- `pnpm test:agent:deepseek` 通过：在自动分配端口的独立内存世界中，通过真实 OpenAI SDK（HTTP 响应替身）及真实 Colyseus 连接验证 AI 身份、观察、移动、聊天、版本校验编辑及重复关闭清理。该测试关闭自身服务，不修改当前 2577 世界。
- Colyseus 的 PM2 指标模块在 Vitest fork 的 IPC 通道内导致进程冲突，因此完整世界验证使用独立 tsx 进程运行；没有忽略未处理错误。
- 没有真实 Key 的 DeepSeek 云调用验证，也没有模型自主规划质量验证。当前开发世界没有重启；旧进程会在 Agent 发起模型调用之前被身份检查识别，并提示加载新版服务。
