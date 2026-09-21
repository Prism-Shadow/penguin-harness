# 大图在浏览器里压缩后再上传

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#802](https://github.com/Prism-Shadow/penguin-harness/pull/802)

[English](2026-09-19-image-compression.md)

嵌入对话的图片会写进 Trace，之后每次翻阅历史、每次恢复 Session 都要整份读回，它的体积因此被反复
付出。现在输入框会在把大图读成 `data:` URL 之前先缩放并重新编码，上传量随图片一同缩小，而不是让
图片撞上 20MB 被拒之门外。

## 细节

- **系统设置 → 上传**（管理员，服务器全局）在原有附件上限旁边多了开关与阈值：默认开启，超过 4MB
  触发，可设 1–64MB。
- 重新编码会把图片放进 2048px 的框内，并保持原格式，因此透明通道得以保留，下游也不会遇到新的格
  式。动图与矢量图（GIF、SVG）一律不碰——经过 canvas 往返，它们会变成第一帧或一张位图，那是另一张
  图，而不是更小的同一张。
- 任何一条失败路径都发送原图：没有 `createImageBitmap`、解码器拒绝、canvas 读不回来，或重新编码后
  并不更小。
- 内嵌图片上限依然生效，比较的是它实际上传时的体积——压缩发生在检查之前，因此过去整张被拒的照片
  现在往往能发出去。
- `GET /api/me` 在 `uploadPolicy` 下报告该策略；`PUT /api/admin/settings` 接受 `imageCompression`
  与 `imageCompressionOverMb`，阈值超范围返回 `400` `invalid_image_compression`。该策略塑造客户端
  上传什么，本身不设关卡。
- 设置页由**上传限制**改名为**上传**：它已经不只是上限了。
