# 无需 Google Cloud 或信用卡的语音接入

Voice Lab 将“回复来源”和“语音识别方式”分开选择。默认使用**本机 Whisper 识别 + 非 AI 回声 + 浏览器朗读**；不再默认调用浏览器厂商的在线识别服务。页面显示“本机 Whisper 已就绪”后可以开始录音。

| 选择                      | 功能                                | 要求                                             |
| ------------------------- | ----------------------------------- | ------------------------------------------------ |
| 语音回声 · 非 AI          | 复述识别文字或输入文字              | 不需要 LLM                                       |
| 本地 AI · Ollama          | 本地模型生成文字回复                | 安装、下载并配置 Ollama 模型；未配置时选项不可用 |
| Mock                      | 仅模拟字幕和状态，无音频            | 不需要模型                                       |
| 本机 Whisper 识别（默认） | 浏览器录音，由本机 whisper.cpp 转写 | 免费模型、whisper-cli、ffmpeg                    |
| 浏览器在线识别（可选）    | Web Speech API 转写                 | 浏览器厂商服务及网络可达，不保证可用             |

## 本机识别准备

本机识别使用 [whisper.cpp](https://github.com/ggml-org/whisper.cpp)。macOS 安装工具：

```sh
brew install whisper-cpp ffmpeg
pnpm voice:setup
pnpm dev
```

`voice:setup` 将官方多语言 base 模型（约 142 MiB）下载到被 Git 忽略的 `.data/voice/ggml-base.bin`，校验大小和 SHA-256 后才启用。首次下载需要联网；模型就绪后，识别不需要账号、信用卡、API key 或外部网络。Windows/Linux 可自行安装 whisper.cpp 与 ffmpeg 并加入服务端 PATH。

默认自动发现该模型路径和 PATH 中的 `whisper-cli`、`ffmpeg`。也可在项目 `.env` 设置绝对路径 `WHISPER_MODEL`、`WHISPER_BIN`、`FFMPEG_BIN`，然后重启服务。缺少工具或模型时，页面会说明原因并提供“重新检测”。安装好模型后可直接重新检测，无需重启；改环境变量需要重启。

## 使用方法

1. 打开“控制台 → 语音设置”，在 Voice Lab 选择回复方案和中文/English。尚未进入世界时可点击“进入并发送”先连接。
2. 保持识别方式为“本机 Whisper · 无需联网识别”。点击“麦克风”，由浏览器申请权限。
3. 说一句话后点击“结束录音”；约 20 秒后会自动结束。识别期间显示进度文字，完成后自动发送识别结果。
4. 也可选择一段 WAV、WebM、MP4 或 Ogg 音频，最长约 20 秒、最大 5 MiB。浏览器必须能读取文件；不能用远程音频 URL 代替文件。
5. “打断”、切换方案、切换识别方式/语言、断线或离开页面，都会取消录音和未完成的识别。识别失败时保留原有文字，不会自动上传到云端。
6. 默认自动朗读；取消勾选可只看字幕。浏览器不允许自动播放时，可点击“朗读回复”重试。

本机录音使用 [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)，需要 localhost / HTTPS 和麦克风权限。录音只发送到本机项目服务；服务通过 ffmpeg 转换为单声道 PCM16/16kHz，再调用 Whisper，结束或取消后删除临时音频和转写文件。原始音频不写入数据库、不广播给其他玩家。识别结果会填入输入框，并发给当前会话选择的回复 provider。

在同一个“接入方案”下拉框中选择“百炼 · 实时语音”，操作区会切换为实时会话设置，右侧同步显示对应说明。百炼直接接收文字或录音并返回语音，不需要配置本机识别与浏览器朗读。进入世界后可连接离线演示或已配置的真实服务；打开设置不会自动建立百炼会话。切换接入方案、切换控制台分类、关闭控制台或退出世界会结束百炼会话并停止其录音与播放。离线演示不访问模型或麦克风，真实服务仍需要服务端启用及用户同意。

为限制本机资源，每次只处理一段音频；并发请求会明确提示稍后重试。转换最长 15 秒，模型识别最长 90 秒。静音、过短、超长、超大或无法解码的文件会报错；超过 240 字不会静默截断。识别质量取决于录音、语言和模型，不能保证每个字都正确。

朗读仍使用浏览器 SpeechSynthesis，优先选择本地已安装的语音。部分语音可能需要联网，所以这里保证的是**本机识别不依赖在线识别服务**，不宣称所有设备的朗读均可离线。

## 浏览器在线识别的网络错误

部分浏览器通过厂商在线服务识别音频，应用即使显示 connected，该服务也可能无法连接。参见 [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)。这是两条不同的连接；重连世界不能修复厂商服务。

需要使用此旧方案时可手动选择“浏览器在线识别”。遇到网络错误，点击“改用本机识别”，然后重新录音。本项目不会尝试绕过浏览器限制，也不会把失败的录音偷偷发送给其他云服务。

## 可选：Ollama 本地 AI 回复

按 [Ollama 官方说明](https://docs.ollama.com/quickstart) 安装本地运行程序，下载适合机器内存的本地模型，例如：

```sh
ollama serve             # 桌面应用已启动服务时无需重复执行
# 另一个终端：
ollama pull qwen2.5:3b
```

在项目 `.env` 中加入（保留已有数据库配置）：

```dotenv
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

重启 `pnpm dev`，刷新页面或重新检测。Ollama 未配置时会标记“未配置”并禁用选项；配置不等于模型已运行，服务未启动或模型缺失时仍会显示具体错误，语音错误不再刷入 WORLD CHAT。

服务器通过 [POST /api/chat](https://docs.ollama.com/api/chat) 获取文字，超时 60 秒，每轮独立，无聊天历史和世界操作工具。只接受本机 HTTP 地址，不跟随重定向、不使用 cloud 模型。它负责回复，不负责识别和朗读。无需 API key；本项目不会自动安装 Ollama 或调用付费云接口。

## 协议

- `GET /voice/capabilities`：返回本机识别准备状态、原因及 `ollamaConfigured`，不返回本机文件路径。
- `POST /voice/transcribe?language=zh|en`：请求体为原始音频，Content-Type 为 audio/wav、audio/webm、audio/mp4、audio/ogg 等；返回 `{text}` 或带状态码的 `{error}`。上传限制 5 MiB，接受指定 `WEB_ORIGIN` 的浏览器跨域请求，本机服务仍只绑定回环地址。
- 识别完成后的 `voice.start` 仍使用 `{text,provider?}`，省略 provider 取服务端 `VOICE_PROVIDER`，默认 mock。WebSocket provider 不接收原始 PCM；音频通过上述 HTTP 接口转写。
- voice 事件仅发给当前请求者，`requestId` 对应 action id，客户端丢弃旧请求的迟到事件。可选 `speakText` 交给浏览器朗读。

自动化会验证录音权限失败、取消、超时、音频校验及 HTTP 边界。真实音频测试和实际麦克风测试是不同证据，详见 [验证记录](VALIDATION.md)。
