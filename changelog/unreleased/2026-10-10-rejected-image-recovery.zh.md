# 被拒的图片不再让会话报废

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`

[English](2026-10-10-rejected-image-recovery.md)

视觉模型的 Provider 拒收 `read_file` 读入的图片（来自路径或 http(s) URL）时，例如 DeepSeek 的 `You have uploaded an unsupported image`，请求以 `fatal` 失败，本轮输入连同图片被暂存，随之后的每条消息重发，此后的请求全都同样失败。

- LLM 层在 Provider 的 4xx 错误中识别图片被拒（格式不受支持或图片损坏、尺寸超限、模型不收图片），以 `error_code: image_rejected` 收尾。
- 本轮输入带图片时，引擎把每张图换成一句固定说明，告诉模型这张图被拒、需要先转成 PNG 或 JPEG，然后立即重试。该次尝试的 `request_end` 记为 `retryable`、`retry_in_ms: 0`，对话里显示在重试提示行上。清理后的输入成为本轮的输入，所以中断或下一条消息都不会再发送这张图。输入里已经没有图片仍被拒时，运行照常结束：问题图片在已提交的历史中。
- 恢复会话时，对 `request_end` 标为 `image_rejected` 的轮做同样替换，重启后图片不会回来。对话视图仍按 Trace 显示这张图。
- `read_file` 只按字节判定图片格式。其实是 SVG、网页或 HEIC 的 `.png` 文件，或自称 `image/png` 的 URL，会被拒绝，提示它实际是什么格式、请先转换。data URL 的 MIME 类型取字节判定的结果。
