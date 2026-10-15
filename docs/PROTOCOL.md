# 协议与扩展边界

客户端先 GET `/world` 获取唯一 `roomId`，再用 Colyseus JS 0.16 `joinById(roomId, {name, kind})` 入房。`kind: scripted-agent` 只用于显示测试身份，不授予权限。这个原型不提供身份认证；只监听本机。

## 大厅实时玩家

GET `/world/presence` 是独立的只读 SSE 订阅，连接后立即发送完整状态，之后每秒推送一次。查看大厅不创建 Avatar、不占用房间名额，退出游戏后订阅继续保留。

每条 `data` 包含 `worldId`、`roomId`、`revision`、`capacity`、`persistence`、`updatedAt` 和 `players`。玩家字段包括 id、昵称、角色、位置、朝向和 connected；不包含重连令牌。在线人数只统计 connected=true，真人和脚本代理分别计数；重连保留期的玩家仍列出并标为“重连中”，不计入在线人数。

跨域访问仅允许配置的 `WEB_ORIGIN`。世界尚未就绪返回 503。客户端断线或 5 秒没有心跳时标记旧数据，2 秒后重新订阅；没有成功获取数据时显示未知，而非 0。组件卸载关闭订阅和定时器。

## 白名单动作

发送房间消息 `action`：`{id: string, type: string, payload: object}`。id 最多 80 字符。未知动作返回 `result` 的 `unknown-action`，无效输入返回具体错误。每会话每秒最多 45 条动作/同步请求，WebSocket 单消息上限 16KB。

| type            | payload                          | 结果                                                                  |
| --------------- | -------------------------------- | --------------------------------------------------------------------- |
| move            | `{x,z,jump,yaw}`，方向分量 -1..1 | 20Hz 权威模拟；没有每帧确认，读取 state；250ms 无输入自动停下         |
| edit            | `{x,y,z,material,revision}`      | material 为 grass/dirt/stone/wood 或 null；result 与 edit 广播        |
| chat            | `{text}`，1..240 字符            | result 和公共 event                                                   |
| observe         | `{}`                             | observation，含 self、附近玩家/方块、revision、events、allowedActions |
| voice.start     | `{text,provider?}`，1..240 字符  | result 与仅本会话 voice 事件；可选 mock / browser / ollama            |
| voice.interrupt | `{}`                             | result 与 interrupted 事件                                            |

`sync` 请求完整 `snapshot`（blocks、revision、persistence）。`edit` 广播携带新版本；客户端发现版本跳跃时重新同步。全局版本用作乐观并发锁：同时提交相同版本仅一条成功，另一条收到 conflict 和最新快照。客户端不会自动重放破坏性编辑，用户基于新状态重试。

## 存储和恢复

程序生成基础地形。数据库 World 保存版本，BlockEdit 保存每个被修改单元的最终覆盖值（null 表示删除基础地形）。单次 Prisma 事务先对预期版本执行 CAS，再 upsert 覆盖值；提交成功后才修改运行内存和广播。失败返回 storage-unavailable，不改变世界。

刷新和异常断线通过标签页 sessionStorage 的 reconnectionToken 恢复；窗口关闭后 20 秒清理。服务器重启后令牌失效，客户端重新加入唯一世界并获取数据库还原的全量状态。

## 语音适配

`VoiceProvider.create(emit)` 返回 `VoiceSession.push(input) / interrupt() / close()`。输入保留类型化 text 或 PCM16/16kHz 边界，当前所有 provider 都拒绝原始 audio。网页默认经本机 HTTP `/voice/transcribe` 接口上传录音并识别，也可选择浏览器在线识别；WebSocket 仍只发送识别后的文字。`VoiceEvent` 包含 provider、state、turn、subtitle、error，以及供客户端朗读的可选 speakText；房间事件附加 requestId（action id）。每个连接独立会话，每次 start 关闭旧会话并创建新会话，因此 turn 只在单次会话内有效，跨请求使用 requestId 区分。打断取消定时器或模型请求，断线关闭会话；迟到结果不再播放。

`voice.start.payload.provider` 可选 mock、browser、ollama，省略时取服务端 VOICE_PROVIDER，默认 mock。browser 返回带有非 AI 标签的回声；ollama 通过服务端调用本机模型生成文字，客户端再朗读。服务端 idle 仅代表生成完成，网页 speaking/idle 由实际朗读回调控制。配置、浏览器兼容性、网络和隐私边界见 [语音接入说明](VOICE.md)。
