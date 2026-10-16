# 语音服务管理与 Agent 发声

控制台的 **文本转语音（TTS）** 页面统一管理可复用的发声配置。左侧列出已保存服务，右侧编辑配置并试听。同一个服务商可以保存多份音色配置，供不同 Agent 使用。

## 配置与试听

1. 打开 **控制台 → 文本转语音（TTS） → 添加语音服务**，填写名称并选择服务类型。
2. 设置服务地址、语音模型、音色及该类型支持的语速。保存配置不会合成音频或调用思考模型。
3. 保存后输入试听文字，点击 **测试连接并试听**。该按钮实际合成音频，同时验证连接、模型与音色；云端服务会收到试听文字并按供应商规则计费。
4. 浏览器阻止自动播放时，可点击音频播放器播放。关闭控制台、切换服务或分类、修改配置、点击停止试听都会中止当前试听请求和播放。

| 类型         | 配置                                                  | 发声方式                                           |
| ------------ | ----------------------------------------------------- | -------------------------------------------------- |
| 本机语音     | 已安装音色、0.5–2 倍语速；音色留空按中英文选择        | 服务器上的 macOS `say` + FFmpeg，无需 API Key      |
| 百炼语音合成 | 北京或新加坡接口、该地域 API Key、Qwen-TTS 模型及音色 | 调用百炼语音合成接口，下载结果音频，不另行生成回答 |
| 兼容语音接口 | API Base URL、API Key、模型、音色、语速               | 请求 `POST /audio/speech`，要求支持 WAV 响应       |

百炼默认模型为 `qwen3-tts-flash`，音色为 `Cherry`；可填写账号和模型支持的其他音色。参数依据 [Qwen-TTS 官方接口](https://help.aliyun.com/en/model-studio/qwen-tts-api)。兼容服务遵循 [Speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)，不代表所有第三方网关均支持该接口。

百炼按模型区分两套协议：`qwen3-tts-*` 使用多模态合成接口；`qwen-audio-3.0-tts-*`、`qwen-audio-3.1-tts-*` 使用 `/services/audio/tts/SpeechSynthesizer`，显式请求 16 kHz WAV。例如 `qwen-audio-3.1-tts-flash` 可搭配 `longanhuan_v3.1`，无需修改已有服务配置。依据 [Qwen-Audio-TTS HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api) 和[音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)。试听与 Agent 发声共用此路由；错误按鉴权、模型、音色、限流分类提示，不回显服务商可能包含密钥或试听文字的原始错误体。

本机音色留空时，中文默认 `Tingting`，英文默认 `Samantha`，可用 `TTS_VOICE_ZH` / `TTS_VOICE_EN` 覆盖。`FFMPEG_BIN` 可指定音频转换工具。合成输出为音频文件，不从服务器扬声器外放。其他操作系统可使用云端或本地兼容 TTS 服务；本机 `say` 类型会明确报告不可用。

## Agent 绑定与运行

在 **创建 Agent** 或 **编辑参数** 中选择已保存的 **语音服务**，或选择 **关闭语音 · 仅文字回复**。可以直接在该表单试听所选服务。思考模型继续负责回复内容，语音服务只合成最终回复。

新建 Agent 默认关闭语音；选中服务后启用。已有开启语音但未保存服务 ID 的 Agent 迁移到 `local-default`。已绑定服务的 Agent 可通过卡片开关临时静音，再次开启仍使用该服务。更换绑定须在 Agent 待命时编辑参数，不会重新启动任务。

试听与 Agent 发声走同一个合成实现，使用相同模型、音色及语速。服务端根据可信管理配置解析 Agent 的绑定；世界动作不能指定云端服务或密钥。只有附近已开启收听的真人玩家收到音频；私聊音频只向指定接收者授权，保留原有距离、朝向与音频下载权限规则。

修改绑定或修改被引用服务会取消旧合成和待发送音频；之后的回复使用新配置。合成失败保留文字回复，原因记入 Agent 日志。更换音色不改变 Agent 的任务进度。

## 保存、删除与恢复

- 配置与密钥保存在被 Git 忽略的 `.data/voice-services.json`，文件权限 `0600`，通过临时文件原子替换保存。
- 浏览器只接收 `hasApiKey`；编辑时密钥留空保留原值，更换服务地址或类型必须重新填写密钥。
- 最多保存 20 个服务。被任何已保存 Agent 引用的服务不能删除；请先将关联 Agent 改为其他服务或选择“关闭语音 · 仅文字回复”。临时静音仍保留引用。
- 重启会恢复服务与绑定，但不会自动试听或启动新的模型推理。已保存服务缺失时，该 Agent 保留文字模式并记录提示，不自动改用另一个云端服务。
- 每次合成最多 240 字，服务调用限时 60 秒、最多两次并发。音频统一转换为单声道 16 kHz PCM WAV，最长约 90 秒；不重试结果未知的云端请求。

## 语音识别（ASR）

控制台在 TTS 右侧提供独立的 **语音识别（ASR）** 页面，可检查自托管 Whisper 是否就绪、重新检查连接，选择中文或英语，通过录音或上传音频文件试用转写。文件上传支持 WAV、WebM、MP4/M4A、OGG，最长 20 秒、最大 5 MiB。实时录音每次最长 5 分钟，显示可修正的临时字幕及逐句追加的确认文字。识别结果仅显示在试用区域，不发送聊天，也不触发 Agent。

讲话过程中持续滚动识别，约 0.9 秒停顿后重新识别完整句子并确认；连续讲话达到 12 秒时会分句，避免无限缓冲。点击“结束录音”提交最后一句；点击“取消识别”、切换分类或关闭控制台会停止录音并取消识别请求。试用会避让聊天录音，并在开始录音时关闭附近语音麦克风。语言选择只作用于这次试用。取消会丢弃未确认内容，已确认结果保留。识别失败不把临时字幕当作最终结果，也不重放结果未知的请求。

实现使用 AudioWorklet 连续采集 16 kHz PCM，每约 1.2 秒将当前句子的完整 WAV 快照上传识别。临时结果可以覆盖修正，停顿后的最终结果按句子顺序提交。它是基于现有 `whisper-cli` 的滚动识别，不是原生流式解码；每次推理仍会启动 CLI 并加载模型，延迟取决于模型、CPU 和服务负载。短句可能在临时推理完成前已结束，直接出现最终结果。

服务端共用串行识别队列，临时请求不排队，最终请求最多等待 4 个。浏览器最多保留两个待确认句子，积压时停止并提示，不悄悄丢句继续发送。临时推理最多 8 秒，实时客户端最终请求最多等待 35 秒；取消和断开会中断识别并清理音频资源。

### 识别服务与实时对话

这份服务列表管理 **语音合成（TTS）**。聊天录音和附近语音继续使用现有 Whisper 识别链路，配置 Agent 的发声服务不会改变玩家录音或转写方式。

在运行项目后端的机器上安装识别工具与模型；例如 macOS 开发环境可用：

```sh
brew install whisper-cpp ffmpeg
pnpm voice:setup
```

模型位于 `.data/voice/ggml-base.bin`，也可以设置 `WHISPER_MODEL`、`WHISPER_BIN`、`FFMPEG_BIN`。Whisper、模型文件和 FFmpeg 部署在项目服务器上，玩家电脑无需安装。录音使用浏览器麦克风权限并上传至项目服务器识别；使用方式见 [聊天与附近语音](CHAT.md)。

原来的回声、Ollama、Mock 和百炼实时对话实验入口已从控制台移除。Ollama 仍可作为 Agent 思考模型；百炼实时对话协议保留独立开发验收，见 [实时语音协议](ALIYUN_REALTIME.md)，它不作为本轮 Agent TTS 服务。

## 接口与验证

语音管理接口复用 `/agents` 的 Origin 检查与 JSON 请求约束：

- `GET /agents/voice-services`：读取不含密钥的服务列表。
- `POST /agents/voice-services` / `PUT /agents/voice-services/:id`：创建和更新配置。
- `DELETE /agents/voice-services/:id`：删除未被引用的配置。
- `POST /agents/voice-services/:id/preview`：`{ text }`，返回 `audio/wav`，断开请求取消合成。
- Agent 创建/更新支持 `voiceServiceId`，`voiceReplies` 仍控制是否发声。

```sh
pnpm check
pnpm format:check
pnpm test:voice:services
pnpm test:voice:live # 固定响应的滚动字幕 HTTP 联调
ASR_TEST_WAV=/absolute/path/mono-16khz.wav pnpm test:voice:live # 真实 Whisper，实时速率回放
REAL_TTS=1 pnpm test:voice:services # macOS 本机真实合成
```

集成测试使用临时配置、隔离内存世界、固定思考模型及本机兼容 TTS 测试接口，覆盖保存、试听、不同 Agent 音色、修改绑定、私聊隔离、删除保护和恢复。`REAL_TTS=1` 额外验证本机试听和 Agent 合成音频；不调用付费模型。真实百炼及第三方云端账号、音质、计费需要另行联调。
