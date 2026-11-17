# 为项目绑定六种模型工具

- **日期：** 2026-11-18
- **类型：** feature
- **范围：** `core`、`server`、`cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[English](2026-11-18-project-model-tools.md)

项目所有者可以分别为网页搜索、网页读取、图片生成、视频生成、语音合成和语音转文字选择模型。工具沿用模型库里配置的连接。模型库新增 MMSP 收录的 GPT-6.2、Gemini 4、Qwen4 和多媒体模型。

运行 `penguin tools list` 查看当前绑定。例如，`penguin tools image "海边的企鹅" --out penguin.png` 会保存生成的图片，`penguin tools stt meeting.wav` 会输出转写文本。耗时任务可以加 `--detach` 后台运行，再用任务 ID 查询状态或取消。

`penguin tools usage` 显示模型、操作、上游返回的 token 计数和实际用量单位。`penguin tools artifacts` 列出生成的文件。在 Agent 终端内，两条命令都默认查询当前会话。
