# 上传不再有体积上限，改为压缩大图

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#426](https://github.com/Prism-Shadow/penguin-harness/pull/426)
- **Breaking:** yes — 管理员可调的附件上限被移除：`/api/admin/settings` 不再有 `attachmentMaxMb` 与 `attachmentTotalMb`，`GET /api/me` 以 `uploadPolicy` 取代 `uploadLimits`。

[English](2026-08-27-uploads-without-a-size-limit.md)

文件附件此前有单个上限、单条消息合计上限、一个供管理员调整两者的表单，以及一条由它们推导出来的请求
体上限；对话内嵌图片则有一条固定 20MB 的拒绝线。这些全部移除。附件不再有体积限制，超过可配置阈值的
图片会在浏览器里先缩放并重新编码再上传，而不是被拒之门外。

## 细节

- **文件附件完全没有体积上限。** 字节写入 Session scratchpad，由模型按路径打开，下游没有任何环节随
  它增长。留下的是单条消息的附件数量上限（20，超出返回 `413` `too_many_files`）与请求体上限。
- **请求体上限被移除**，也没有换成一个常量。仅剩的天花板来自平台：请求体在交给 `JSON.parse` 之前
  会被解码成一个字符串，而 V8 对字符串长度的上限约为 512MB。超过它的请求返回 `413`
  `payload_too_large` 并报出那个天花板——失败依然清晰可读，却不含任何本服务自定的数字。
- **自动压缩图片**（**系统设置 → 上传**，仅管理员、服务器全局）：一个默认开启的开关，以及一个以整数
  MB 填写的阈值，默认 4，取值范围 1–64。超过阈值的图片会缩放到 2048px 见方以内、按原格式重新编码，
  然后才读成 data URL，因此上传体积随图片一起变小。小于阈值的图片，以及任何动图与矢量图（GIF、
  SVG），按原字节发送；重新编码后若并未变小，结果会被丢弃。
- **`GET /api/me` 下发 `uploadPolicy`**：两项设置、阈值的取值范围，以及单条消息的附件数量上限。它塑
  造客户端上传什么，不构成关卡——忽略它的 API 调用方不会被拒绝。
- 不再抛出 `413` 错误码 `file_too_large`（针对输入框附件）与 `image_too_large`；`payload_too_large`
  现在只意味着「超出本 API 能解码的体积」；阈值超出范围时
  `PUT /api/admin/settings` 返回 `400` `invalid_image_compression`，取代 `invalid_attachment_limit`。

## 兼容性

- 读取 `GET /api/me` 的 `uploadLimits`，或向 `PUT /api/admin/settings` 写入 `attachmentMaxMb` /
  `attachmentTotalMb` 的客户端需要更新：这些字段已不存在，且 PUT 中未知字段会被忽略而非拒绝。
- `server_settings` 里已存的 `attachment_max_mb` 与 `attachment_total_mb` 行原样保留、不再被读取。
  无需迁移、也无需删除；曾把上限调低的服务器只是不再应用它。
