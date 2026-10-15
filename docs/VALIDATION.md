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
