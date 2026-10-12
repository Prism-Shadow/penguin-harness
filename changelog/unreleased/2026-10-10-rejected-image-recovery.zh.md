# 被拒的图片不再让会话报废

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[English](2026-10-10-rejected-image-recovery.md)

视觉模型的 Provider 拒收 `read_file` 读入的图片（来自路径或 http(s) URL）时，例如 DeepSeek 对一张合法的 750×8618 PNG 长截图报 `You have uploaded an unsupported image`，请求以 `fatal` 失败，本轮输入连同图片被暂存，随之后的每条消息重发，此后的请求全都同样失败。

- 带图片的请求被 Provider 以 4xx 拒绝时，不论报文怎么写，一律视为图片被拒：Provider 对这类拒绝的措辞五花八门，按文字匹配并不可靠。引擎把该次尝试的 `request_end` 记为 `retryable`、`error_code: image_rejected`、`retry_in_ms: 0`，把本轮输入中的每张图片换成一句固定说明（`[image not sent: the current model rejected the request while it carried this image, so the request was sent again without the image.]`），然后立即重试；Provider 的报错原文经重试输入的 `[request_error]` 行到达模型（见[重试会告诉模型失败的原因](2026-10-11-retry-carries-error.zh.md)），对话里显示在重试提示行上。清理后的输入成为本轮的输入，所以中断或下一条消息都不会再发送这张图。输入不带图片的 4xx 照常结束运行。
- 恢复会话时，对 `request_end` 标为 `image_rejected` 的轮做同样替换，重启后图片不会回来。对话视图仍按 Trace 显示这张图。
- `read_file` 只按字节判定图片格式。其实是 SVG、网页或 HEIC 的 `.png` 文件，或自称 `image/png` 的 URL，会被拒绝，提示它实际是什么格式、请先转换。data URL 的 MIME 类型取字节判定的结果。
