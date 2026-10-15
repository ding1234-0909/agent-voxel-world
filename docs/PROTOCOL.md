# 协议与扩展边界

客户端先 GET `/world` 获取唯一 `roomId`，再用 Colyseus JS 0.16 `joinById(roomId, {name, kind})` 入房。`kind: scripted-agent` 和 `kind: ai-agent` 分别显示脚本代理和 AI 代理身份，不授予额外权限。其他值按 human 处理。这个原型不提供身份认证；只监听本机。

## 大厅实时玩家

GET `/world/presence` 是独立的只读 SSE 订阅，连接后立即发送完整状态，之后每秒推送一次。查看大厅不创建 Avatar、不占用房间名额，退出游戏后订阅继续保留。

每条 `data` 包含 `worldId`、`roomId`、`revision`、`capacity`、`persistence`、`updatedAt` 和 `players`。玩家字段包括 id、昵称、角色、位置、朝向和 connected；不包含重连令牌。在线人数只统计 connected=true，真人和脚本代理分别计数；重连保留期的玩家仍列出并标为“重连中”，不计入在线人数。

跨域访问仅允许配置的 `WEB_ORIGIN`。世界尚未就绪返回 503。客户端断线或 5 秒没有心跳时标记旧数据，2 秒后重新订阅；没有成功获取数据时显示未知，而非 0。组件卸载关闭订阅和定时器。

## 白名单动作

发送房间消息 `action`：`{id: string, type: string, payload: object}`。id 最多 80 字符。未知动作返回 `result` 的 `unknown-action`，无效输入返回具体错误。每会话每秒最多 45 条普通动作/同步请求；空间语音信令另有每秒 120 条限额，WebSocket 单消息上限 16KB。

| type            | payload                                                           | 结果                                                                  |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| move            | `{x,z,jump,yaw}`，方向分量 -1..1                                  | 20Hz 权威模拟；没有每帧确认，读取 state；250ms 无输入自动停下         |
| edit            | `{x,y,z,material,revision}`                                       | material 为 grass/dirt/stone/wood 或 null；result 与 edit 广播        |
| chat            | `{text,scope?,recipients?}`，1..240 字符；scope 为 public/private | result 和按接收范围过滤的 event                                       |
| observe         | `{}`                                                              | observation，含 self、附近玩家/方块、revision、events、allowedActions |
| voice.start     | `{text,provider?}`，1..240 字符                                   | result 与仅本会话 voice 事件；可选 mock / browser / ollama            |
| voice.interrupt | `{}`                                                              | result 与 interrupted 事件                                            |

`sync` 请求完整 `snapshot`（blocks、revision、persistence）。`edit` 广播携带新版本；客户端发现版本跳跃时重新同步。全局版本用作乐观并发锁：同时提交相同版本仅一条成功，另一条收到 conflict 和最新快照。客户端不会自动重放破坏性编辑，用户基于新状态重试。

## 存储和恢复

程序生成基础地形。数据库 World 保存版本，BlockEdit 保存每个被修改单元的最终覆盖值（null 表示删除基础地形）。单次 Prisma 事务先对预期版本执行 CAS，再 upsert 覆盖值；提交成功后才修改运行内存和广播。失败返回 storage-unavailable，不改变世界。

刷新和异常断线通过标签页 sessionStorage 的 reconnectionToken 恢复；窗口关闭后 20 秒清理。服务器重启后令牌失效，客户端重新加入唯一世界并获取数据库还原的全量状态。

## 语音适配

`VoiceProvider.create(emit)` 返回 `VoiceSession.push(input) / interrupt() / close()`。输入保留类型化 text 或 PCM16/16kHz 边界，当前所有 provider 都拒绝原始 audio。网页默认经本机 HTTP `/voice/transcribe` 接口上传录音并识别，也可选择浏览器在线识别；WebSocket 仍只发送识别后的文字。`VoiceEvent` 包含 provider、state、turn、subtitle、error，以及供客户端朗读的可选 speakText；房间事件附加 requestId（action id）。每个连接独立会话，每次 start 关闭旧会话并创建新会话，因此 turn 只在单次会话内有效，跨请求使用 requestId 区分。打断取消定时器或模型请求，断线关闭会话；迟到结果不再播放。

`voice.start.payload.provider` 可选 mock、browser、ollama，省略时取服务端 VOICE_PROVIDER，默认 mock。browser 返回带有非 AI 标签的回声；ollama 通过服务端调用本机模型生成文字，客户端再朗读。服务端 idle 仅代表生成完成，网页 speaking/idle 由实际朗读回调控制。配置、浏览器兼容性、网络和隐私边界见 [语音接入说明](VOICE.md)。

## 聊天音频与空间语音协议

`chat` 默认 public；private 必须提供 1–8 个唯一、在线、非发送者的会话 ID。服务端填入发送者身份，事件 data 带 scope、recipients、name、text、kind；audio 消息另带 audioId、durationMs、transcriptAvailable。私聊不广播，observe 同样先过滤再截取历史。私聊的群发对象列表仅发送者和接收者可见。

入房和重连后仅当前连接收到 `chat.auth: {token}`。HTTP `/chat/*` 限制 WEB_ORIGIN 并要求 `Authorization: Bearer <token>`；令牌在退出和重连时失效。POST `/chat/audio?scope=private&to=id1,id2&language=zh` 接收原始音频（1 MiB 上限），验证长度和格式后发布音频事件。GET `/chat/audio/:id` 按消息范围校验，未授权或过期返回 404，无效会话凭证返回 401。不要将令牌放 URL。

真人动作 `spatial.state: {sending:boolean,listening:boolean}` 更新 Avatar 的 voiceSending/voiceListening。`spatial.signal: {to,description?:{type,sdp},candidate?:RTCIceCandidateInit}` 只转发给已选择参与的真人目标，收到的消息为 `spatial.signal: {from,description?,candidate?}`。服务器填入 from，限制 SDP / ICE 大小；不存储、转播或交付 Agent。二进制音频走 WebRTC，不经过游戏 WebSocket。客户端按 20Hz 同步的角色位置和 yaw 混音，静止时保留最后朝向。详见 [聊天与附近语音](CHAT.md)。

### 附近语音自动转写

麦克风开启后，客户端 POST `/chat/spatial/start` 获得片段 id；服务器要求真人、在线、voiceSending=true，并固定当时可听者的会话集合。随后 POST `/chat/spatial/:id` 上传完整、可独立解码的音频段（最大 1 MiB），本机 Whisper 转写后，按开始和完成时可听者交集发布 `chat` 事件，data.scope=`nearby`、kind=`text`、transcriptAvailable=true。发送者也收到字幕。此范围由服务器生成，普通 chat 动作不允许声明 nearby。

可听阈值为共享 spatialMix 的 gain >= 0.03，真人需要 voiceListening，Agent 自动接收。nearby 与 private 一样过滤 WebSocket 事件和 observe，不属于全世界广播；Agent 执行器将 nearby 回复限制为发给说话者的私聊，公共推理轮次不携带附近谈话上下文。

片段 id 绑定发送者，单次使用，45 秒过期，每人最多 4 个捕获/处理中的片段。DELETE `/chat/spatial/:id` 撤销片段；关闭麦克风或会话撤销时同时取消该玩家全部片段及正在执行的识别。所有接口沿用 chat 的 Origin 和会话凭证校验，识别结果发布前再次校验会话与片段有效性。

## Agent 空间语音回复

Agent 专用动作 `agent.voice: {enabled:boolean}` 设置 Avatar 的 `voiceReplies`；真人调用拒绝。托管控制台 POST `/agents/:id/voice` 可即时更新并保存开关，创建/编辑配置也支持 `voiceReplies`。已有配置默认为 false，独立 DeepSeek 进程通过 `AGENT_VOICE_REPLIES=true` 开启。

Agent 的 public/private 文字聊天触发服务端本机 TTS；文字事件照常即时投递。合成后仅授权听者收到 `agent.speech: {id,actor,text,scope,durationMs,expiresAt}`，使用当前会话凭证 GET `/chat/agent-speech/:id` 获取 WAV。听者必须在发言和合成完成时都开启收听、在线且 spatialMix.gain >= 0.03；private 还必须在原接收者列表。下载时再次核验身份、双方状态和可听范围；失效/越权返回 404。音频不放入观察历史，防止 Agent 互相重复消费自己的朗读。

关闭 Agent 语音、离开或断线撤销其排队合成与缓存；合成失败仅向该 Agent 发 `agent.speech.error: {message}`，不会撤销文字。音频缓存最长 120 秒、24 段 / 32 MiB，合成串行，等待队列最多 8 段且每角色最多 2 段，排队超过 30 秒跳过。`GET /voice/capabilities` 中 `agentSpeech: {available,reason}` 表示本机合成可用性。
