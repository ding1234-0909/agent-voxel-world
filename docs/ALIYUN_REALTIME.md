# 百炼实时语音：离线可验证的接入层

实时对话协议适配器与离线集成脚本仍保留。控制台已改为可保存、可绑定 Agent 的语音合成服务管理，原实验 UI 已移除；当前用法见 [语音服务](VOICE.md)。这里的实时会话会生成回答，与只朗读 Agent 回复的 TTS 服务是不同能力。

**真实百炼实时模型、真实麦克风、账号计费及端到端音质尚未联调。** 模拟器只产生固定字幕、合成提示音和测试方块建议，不代表真实模型质量。

## 独立协议验收

```sh
pnpm --filter @voxel/server exec tsx test/integration/realtime.ts
```

该脚本使用隔离世界与固定响应，不调用付费模型。历史 `realtime-preview.mjs` 页面预览不再提供实时语音入口，请使用上面的协议集成脚本。

## 协议及安全边界

依据 2026-10-16 查阅的官方文档：

- [Qwen-Audio 实时语音用户指南](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides)
- [qwen-audio-3.1-realtime-plus](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-realtime-plus)

当前实现北京区域、`qwen-audio-3.1-realtime-plus`，默认音色 `longanqian_v3.1`。输入单声道 PCM16 LE / 16kHz，输出24kHz。采用手动结束录音的模式：等待 `session.updated` 后发送音频，`input_audio_buffer.commit` 后请求 `response.create`。工具结果在当前 `response.done` 后才触发下一轮生成，避免重叠响应。

服务端未来可配置以下变量（本轮没有写入配置或读取密钥）：

| 变量                       | 行为                                                   |
| -------------------------- | ------------------------------------------------------ |
| `BAILIAN_REALTIME_ENABLED` | 默认不启用；仅精确的 `true` 允许真实连接               |
| `BAILIAN_WORKSPACE_ID`     | 北京区域业务空间ID，构造固定官方域名；不接受客户端URL  |
| `BAILIAN_REALTIME_MODEL`   | 默认3.1 Plus；其他模型明确拒绝，待协议验证后扩展白名单 |
| `BAILIAN_REALTIME_VOICE`   | 服务端音色选择，默认longanqian_v3.1                    |
| `DASHSCOPE_API_KEY`        | 仅在真实模式且开关启用后，服务端延迟读取               |

真实会话还要求当前玩家明确同意发送本次输入。不开启浏览器麦克风就不会采集音频；点击录音后才请求权限。录音最多14秒，结束、取消、断线、隐藏页面或关闭面板会停止音轨；待批准的麦克风权限请求也有取消保护。输入不是本地持久化文件；适配器不记录原音频或密钥，不在错误中回传上游原始错误文本。

不提供网页配置密钥入口，不支持任意上游域名，不自动重连或回退到另一付费服务。中断会发送可用的取消信号并**关闭整个会话**，丢弃迟到音频及所有待确认建议；再次连接需手动操作。

限制：单块输入6400字节、每轮最多15秒输入；每轮输出最多30秒，播放排队超过2秒关闭；会话最多120秒、每轮最多4次工具调用、最多8个待确认建议、就绪超时10秒。房间现有请求频率限制继续生效。录音尾部不足100毫秒的半块会被丢弃。以上是资源保护，**不是人民币费用硬上限**；真实联调仍须预算、账号资格、安全凭据和数据范围确认。跨账号并发/账单预算控制尚未实现，不能据此开放公共付费服务。

## 场景工具

默认不提供场景工具；由玩家在连接前勾选。仅有：

1. `observe_scene`：当前位置、朝向、世界版本，以及6格内最近64个方块；不包括其他玩家身份、聊天、私聊、历史或音频。
2. `propose_block_edit`：参数必须是有界整数坐标和合法材质，生成30秒有效且仅当前会话可消费一次的建议。工具本身不会修改世界。玩家确认后复用房间原有串行编辑队列、版本冲突、距离、碰撞、基岩及持久化验证；并发变更导致旧建议被拒绝。

没有移动、发聊天、任意URL访问、脚本执行或数据库工具。用户输入和模型工具参数都不能扩展此白名单。断线后旧会话/建议失效。

浏览器消息：`realtime.start`（mode=demo/real、request、sceneConsent、audioConsent），`realtime.audio`（session、audio），`realtime.commit`（session，可选text），`realtime.stop`（session或当前request），`realtime.approve`（session、proposalId）。服务端 `realtime` 事件携带request与session，区分ready/subtitle/audio/proposal/done/error/closed；事件仅发回所属玩家。

## 验证记录（2026-10-16）

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @voxel/server exec tsx test/integration/realtime.ts
```

- TypeScript检查、构建通过；全量27个测试文件、186项测试通过（包括工作树中原有已暂存功能）。
- 新增16项离线测试：真实模式开关优先于凭据访问和拨号、手动音频格式、输入/输出生命周期、工具去重与续接顺序、建议归属/一次性/过期、白名单、取消和迟到音频、错误脱敏、背压与超时、固定模拟事件；浏览器PCM解码、播放停止、44.1kHz和48kHz流式重采样、麦克风权限拒绝及取消后迟到授权；未就绪会话的归属和取消。
- 独立Colyseus内存世界：两个协议玩家与一个脚本Agent同时连接；真实模式被禁用、私有模拟音频、无确认不修改、跨玩家确认拒绝、确认后3端方块同步、重复确认及断线旧会话拒绝全部通过。
- Edge实际浏览器：进入隔离世界、默认真实按钮禁用、离线连接、字幕/建议显示、确认修改、中断后发送禁用。播放路径执行，未以人工听音方式评估音质。
- **没有测试真实模型、实际麦克风采集、计费、云端网络稳定性、学生数据、PostgreSQL重启恢复。** 多客户端同步是协议客户端测试，不宣称两个独立浏览器加Agent全部实测。

原有25个暂存文件保持原样，本轮提交通过精确路径隔离。首次提交 `a1668ce` 为协议适配和测试；后续提交为游戏/UI连接及验收文档。
