# 为项目绑定八种模型工具

- **日期：** 2026-11-18
- **类型：** feature
- **范围：** `core`、`server`、`cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[English](2026-11-18-project-model-tools.md)

项目所有者可以分别为网页搜索、网页读取、图片生成、视频生成、语音合成和语音转文字选择模型。工具沿用模型库里配置的连接。模型库新增 MMSP 收录的 GPT-6.2、Gemini 4、Qwen4 和多媒体模型。

内置的「多模态工具」插件提供八种操作，并为默认 Agent 安装调用说明。管理员可以为单个项目关闭或重新启用插件。项目会保留已选模型、生成文件和用量记录。

运行 `penguin tools --help` 查看当前项目插件提供的命令，用 `penguin tools list` 查看模型绑定。连接远程服务器时，输入和输出文件也在运行 CLI 的机器上读写。例如，`penguin tools image "海边的企鹅" --out penguin.png` 会保存生成的图片，`penguin tools stt meeting.wav` 会输出转写文本。耗时任务可以加 `--detach` 后台运行，再用任务 ID 查询状态或取消。

`penguin tools usage` 显示模型、操作、上游返回的 token 计数和实际用量单位。`penguin tools artifacts` 列出生成的文件。在 Agent 终端内，两条命令都默认查询当前会话。工具调用和语音润色也会把同一个会话 ID 传给 MMSP，供模型服务商路由缓存。

DeepSeek ASR 支持 DeepSeek 官方和词元跳动两个服务商。已有项目可在模型库点击「同步新增模型」添加词元跳动预设。在项目设置中选定服务商后，可上传 16 位 PCM WAV 或 Ogg Opus 录音。Penguin 会在调用模型前检查音频格式。在模型卡上测试语音识别模型时，Penguin 会发送一段内置测试语音。

项目工具模型统一保存到 `[tools]`。视觉代理使用 `i2t`，开启听写润色后使用 `t2t`。首次读取旧项目时自动迁移原有绑定。默认聊天模型单独选择。 [项目工具模型迁移](2026-11-19-backward-compatibility.zh.md)

项目所有者可以编辑听写润色提示词，也可以随时恢复内置提示词。对于支持的模型，听写润色会关闭思考或使用模型支持的最低推理档位。

专用图像、视频、语音和网页工具模型可设为对应能力的默认模型。新对话使用支持聊天的模型。
