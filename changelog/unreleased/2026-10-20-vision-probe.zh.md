# 模型配置的「检测视觉」发送一张能解码的图片，并如实说明检测结果

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1265](https://github.com/Prism-Shadow/penguin-harness/pull/1265)
- **Issue:** [#1264](https://github.com/Prism-Shadow/penguin-harness/issues/1264)

[English](2026-10-20-vision-probe.md)

模型配置里的「检测视觉」对使用严格图片解码器的端点恒定失败：探测用的 1×1 PNG 比文件头声明的少两个字节。在会转述服务商原文的客户端上，解码器的「unsupported image」被当成模型拒绝图片，支持图片的模型反而被关掉了视觉开关。失败提示还借用了协议探测的「请检查 API Key 与 base URL」。

## 细节

- **探测图。** 常量换成 IDAT 解压后正好是文件头声明的五个字节的 1×1 RGBA PNG。测试逐 chunk 校验 CRC 并解压 IDAT，图片不完整时在 CI 里失败，而不是到网关才失败。
- **文案。** 视觉检测没有得出结论时如实说明——「无法判断该模型是否接受图片输入，视觉保持不变」——不再把人引去查 API Key 与 base URL。文档的模型页同步更新。
