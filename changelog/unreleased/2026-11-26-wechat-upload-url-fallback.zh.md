# 发往微信的图片与文件能送达，并能在微信客户端中打开

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `messaging`
- **PR:** [#1919](https://github.com/Prism-Shadow/penguin-harness/pull/1919)

[English](2026-11-26-wechat-upload-url-fallback.md)

只要 `ilink/bot/getuploadurl` 的应答只带 `upload_param`、不带 `upload_full_url`，向微信对话发送图片或文件就会以「the upload URL was not returned」失败。入站消息中只带 `encrypt_query_param`、不带 `full_url` 的媒体也会同样被丢弃。已送达的图片与文件在微信客户端中无法打开，图片显示为不可用；现在可以正常打开。

## 细节

- 平台返回 `upload_full_url` 时，上传发往该地址；否则发往 `https://novac2c.cdn.weixin.qq.com/c2c/upload`，以 URL 编码后的 `upload_param` 与文件 key 作为查询参数。CDN 根地址与取用顺序都与腾讯自己的 `openclaw-weixin` 客户端一致。
- 只带 `encrypt_query_param` 的入站图片、文件与视频，以该参数从 `https://novac2c.cdn.weixin.qq.com/c2c/download` 下载；`full_url` 仍然优先。
- 上传应答两个字段都没有时，错误信息列出应答实际携带的字段名，从不包含字段值。
- 出站图片与文件的 `aes_key` 改为 key 的 32 位小写十六进制字符串的 base64，与腾讯自己的发送端写法一致，不再是 16 字节原始 key 的 base64。CDN 密文与发给 `getuploadurl` 的 `aeskey` 不变，入站 key 仍接受两种形式。
