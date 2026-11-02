# 公司面的 JSON 应答走压缩（zstd 优先、gzip 兜底）

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1285](https://github.com/Prism-Shadow/penguin-harness/pull/1285)

[English](2026-10-21-org-json-packed.md)

调用方声明接受压缩时，JSON 应答就打包回——调用方和这个 Node 都认 zstd 时用 zstd，否则 gzip：GET 的 200、JSON 内容类型、至少两 KB——任何路由组都一样，插件页的列表也在内。在引发这件事的公司列表上，gzip 压到底也还比要背的线高出一截，zstd 的最高级才压得过线。流式应答（SSE、下载）不动，机器代理 `/server/…` 原样转交机器自己的应答：路由在机器上，编码由它定，浏览器带来的 `Accept-Encoding` 照原样传到。压缩跑在线程池里，不占主事件循环。
