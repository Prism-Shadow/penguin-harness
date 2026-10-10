# 被拒的图片不再让会话报废

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[English](2026-10-10-rejected-image-recovery.md)

视觉模型的 Provider 拒收 `read_file` 读入的图片（来自路径或 http(s) URL）时，例如 DeepSeek 对一张合法的 750×8618 PNG 长截图报 `You have uploaded an unsupported image`，请求以 `fatal` 失败，本轮输入连同图片被暂存，随之后的每条消息重发，此后的请求全都同样失败。

- LLM 层在 Provider 的 4xx 错误中识别图片被拒（格式不受支持或图片损坏、尺寸超限、模型不收图片），以 `error_code: image_rejected` 收尾。OpenAI 的 `requires N patches after processing, exceeding the limit` 措辞也在识别之列。
- 本轮输入带图片时，引擎把图片换成一段写给模型的说明，然后立即重试。说明逐张给出图片的格式、像素尺寸和字节大小，引用 Provider 的报错，列出常见原因，主要是图片超出 Provider 能接收的大小，而 Provider 常把这种情况报成格式不受支持；随后说明怎样做出一份能通过的副本：用 shell 命令把图片裁切或缩小到每边不超过 2000 px，再读取这份副本。该次尝试的 `request_end` 记为 `retryable`、`retry_in_ms: 0`，对话里显示在重试提示行上。清理后的输入成为本轮的输入，所以中断或下一条消息都不会再发送这张图。输入里已经没有图片仍被拒时，运行照常结束：问题图片在已提交的历史中。
- 恢复会话时，对 `request_end` 标为 `image_rejected` 的轮做同样替换，并按记录下的 `error_message` 重建同一段说明，重启后图片不会回来。对话视图仍按 Trace 显示这张图。
- `read_file` 只按字节判定图片格式。其实是 SVG、网页或 HEIC 的 `.png` 文件，或自称 `image/png` 的 URL，会被拒绝，提示它实际是什么格式、请先转换。data URL 的 MIME 类型取字节判定的结果。
- `read_file` 读图片时输出的那一行现在给出像素尺寸（`image/png, 750×8618 px, 960.6 kB`）。为纯文本模型读图的视觉模型拒收图片时，工具输出会附上同样的原因与建议。
