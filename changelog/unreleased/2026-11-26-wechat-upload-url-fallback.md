# Images and files sent to WeChat arrive and open in the WeChat client

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `messaging`
- **PR:** [#1919](https://github.com/Prism-Shadow/penguin-harness/pull/1919)

[中文版](2026-11-26-wechat-upload-url-fallback.zh.md)

An image or file sent to a WeChat chat failed with "the upload URL was not returned" whenever
`ilink/bot/getuploadurl` answered with `upload_param` and no `upload_full_url`. Media in an inbound
message that carried `encrypt_query_param` and no `full_url` was dropped the same way. Images and
files that were delivered could not be opened in the WeChat client, which showed a picture as
unavailable. They now open.

## Details

- The upload goes to `upload_full_url` when the platform returns one. Otherwise it goes to
  `https://novac2c.cdn.weixin.qq.com/c2c/upload` with the URL-encoded `upload_param` and file key
  as query parameters, the same CDN base and order that Tencent's own `openclaw-weixin` client uses.
- An inbound image, file or video with only `encrypt_query_param` is downloaded from
  `https://novac2c.cdn.weixin.qq.com/c2c/download` under that parameter. `full_url` is still
  taken first.
- When the upload answer carries neither field, the error lists the field names it did carry. Field
  values never appear in it.
- The `aes_key` of an outbound image or file is base64 of the key's 32 lowercase hex characters,
  as Tencent's own senders write it, instead of base64 of its 16 raw bytes. The CDN ciphertext and
  the `aeskey` sent to `getuploadurl` are unchanged, and inbound keys are still read in either form.
