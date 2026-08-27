# 热更新通道为解压后的体积设了界

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#426](https://github.com/Prism-Shadow/penguin-harness/pull/426)

[English](2026-08-23-hot-update-inflate-is-bounded.md)

`POST /api/hmr/upgrade` 解压 gzip 请求体时没有任何界限：几百 KB 的传输量就能决定这个进程分配多少
GB，而请求要等到 `JSON.parse` 撞上已经解压出来的内容才会失败。`zlib.gunzipSync` 现在带上了
`maxOutputLength`。

## 细节

- 这个界限读自平台而不是自行选定：`buffer.constants.MAX_STRING_LENGTH`，约 512MB。超过它，载荷就无
  法变成 `JSON.parse` 所需的那个字符串——无论允许推送多大都是如此。所以它拒绝的恰好是那些本来就不
  可能成功的载荷，仅此而已。真实推送是个位数 MB。
- 推送本身的体积不设上限。没有这个界限时，进程会一直分配到死掉，永远走不到那个本该抛错的字符串。
