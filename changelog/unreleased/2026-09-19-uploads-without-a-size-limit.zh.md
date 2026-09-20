# 上传不再有体积上限，两套 API 也不再限制请求体

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#805](https://github.com/Prism-Shadow/penguin-harness/pull/805)
- **Breaking:** yes

[English](2026-09-19-uploads-without-a-size-limit.md)

单个附件上限、单条消息的字节合计、设置它们的管理员字段、由它们推导出来的请求体上限，以及内嵌图片
那条固定的拒绝线，全部移除。这些数字拒绝的都是传输本身完全扛得住的上传，而那道门槛不过是某位运维
在某个时刻填下的数。留下的是平台自身的天花板——它被如实报出，而不是由谁选定。

## 细节

- **附件没有体积上限。** 文件写入 Session scratchpad，模型通过自己那套有界的文件工具按路径打开，
  上传之后没有任何环节的开销随它增长。输入框的上传不再返回 `413` `file_too_large`；Workspace 文件
  接口仍保留各自无关的上限。
- **内嵌图片被压缩，而不是被拒绝。** 20MB 那条线取消，改由与之配套的浏览器端压缩承担。
- **`/api/*` 与 `/api/hmr` 都不再限制请求体体积。** 请求体在交给 `JSON.parse` 之前会被解码成一个
  字符串，而 V8 对字符串长度的上限约为 512MB——无论有没有人守着，这都是天花板。`readJson` 现在把
  `ERR_STRING_TOO_LONG` 从它过去一并吞掉的解析错误里分出来，返回 `413` `payload_too_large` 并报出
  那个天花板：若仍报「必须是合法 JSON」，只会让人去一段并无语法错误的请求体里找语法错误。
- **单条消息的文件数量上限保留**（20，`413` `too_many_files`）。它约束的是一条消息能点名多少文件
  ——同一个目录里那么多次顺序写入、同一条消息上那么多行标记——这是任何传输天花板都管不到的。
- **消息通道保留自己的入站上限**（单个 100MB、单条消息 120MB，见
  `MESSAGING_INBOUND_FILE_MAX_BYTES` 及其预算）。它们不是换了名字的输入框上限：它们约束的是本服务
  因为有人在群里发了文件而执行的一次下载，而没有上限的下载没有停下来的地方。

## 舍弃了什么

这些是改动的要点而非疏漏，故明说：

- 服务端不再拒绝来自非浏览器客户端的大图。Web App 会压缩；而一个 API 调用方塞进 400MB 的 data URL，
  就会把 400MB 写进 Trace，并在每次恢复会话时付出这笔开销。
- 一个已认证的调用方可以让服务端为单个请求缓冲到字符串天花板，并发还会成倍放大。被移除的
  `/api/*` 上限正是约束这件事的东西，没有替代品。

## 兼容性

- **API。** `GET /api/me` 不再返回 `uploadLimits`，单条消息的文件数量上限移到
  `uploadPolicy.attachmentMaxCount`。`PUT /api/admin/settings` 不再接受 `attachmentMaxMb` 与
  `attachmentTotalMb`，`400` `invalid_attachment_limit` 随之取消。输入框的上传不再返回 `413`
  `file_too_large` 或 `image_too_large`。
- **磁盘上。** `server_settings` 里的 `attachment_max_mb` 与 `attachment_total_mb` 两行此后不再被
  读取。没有迁移，也没有兼容代码：缺行本来就表示「使用默认值」，因此留着一行陈旧数据不产生任何代
  价，回滚到旧版本的服务器也仍能原样读到自己的数字。日后无需清理，运维现在也无需动手。
