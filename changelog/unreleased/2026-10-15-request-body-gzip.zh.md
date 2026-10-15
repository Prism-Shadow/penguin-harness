# 任务与 steer 请求体可 gzip 传输

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`
- **Issue:** [#521](https://github.com/Prism-Shadow/penguin-harness/issues/521)

[English](2026-10-15-request-body-gzip.md)

草稿期没有 Session，文件附件只能以 base64 `data:` URL 的形式搭乘任务请求本身——base64 再膨胀三分之一，且全程无压缩，100MB 的日志要在网络上跑约 134MB。现在 Web App 的任务与 steer 发送方会把序列化后的整个请求体 gzip 后发出，服务器在路由读取 JSON 之前完成有界解压。不带该编码到达的请求走的与从前完全同一条路径，非浏览器的 API 调用方不受任何影响。

## 细节

- 发送方只在 gzip 确实能压小时才压缩：小请求体原样发送，本身已是压缩字节的附件（`.zip`、`.jpg`、`.mp4`）也发明文，不为多出的字节付一次压缩。编码全程无损——文件附件一个字节都不能丢，所以这只是传输编码，不同于图片通道的重编码。
- 解压有界：`gunzipSync` 带 `maxOutputLength` 运行，上限由既有的请求体上限推导而来，gzip 炸弹因此回答 `413` `payload_too_large` 而不是任其分配内存，无法解压的请求体则是 `400` `bad_request`。线上传输的上限仍按压缩后字节计，限制内存的是解压上限。
- steer 路由的 `files` 字段与任务的 `{fileName, dataUrl}` 部件同形，gzip 后的 steer 请求体以同样的方式携带附件。
