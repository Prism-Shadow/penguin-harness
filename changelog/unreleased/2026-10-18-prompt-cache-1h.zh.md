# 模型可以把提示缓存保留一小时

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `docs`
- **PR:** [#1211](https://github.com/Prism-Shadow/penguin-harness/pull/1211)

[English](2026-10-18-prompt-cache-1h.md)

模型条目现在可以申请一小时提示缓存，而不再沿用供应商默认的五分钟。在
`.project_config.toml` 里写入 `prompt_cache_1h = true`、在 Web 的模型弹窗里打开
**1 小时缓存**开关，或者给 `penguin config model add` 加上 `--prompt-cache-1h`，都会让这个模型的
Session 请求发出 MMSP 的 `prompt_caching = enhance`，Anthropic 协议客户端再把它变成
`cache_control: { type: "ephemeral", ttl: "1h" }`。搁置超过五分钟后再接着用的对话，此后会从供应商
的缓存里读回整个前缀，而不必重新付费处理一遍。

## 细节

- 这个标注存在模型条目上，和 `fast_mode` 一样只持久化 `true`：省略字段或传 `false` 会清空它，
  不提及它的更新则保留已存的值。手工写入的 `prompt_cache_1h = false` 保持关闭，并在下一次写入时
  被规范化掉。
- 只有路由到 MMSP `anthropic-official` 客户端的模型能携带它。路由依次看条目自己的 `client_type`、
  分组的，然后是 `model_id` 开头的厂商系列（`claude-`）。Web 弹窗只在那里提供开关，并在条目已在
  不支持的线路上存了 `true` 时保留开关，以便关掉；CLI 照常写入条目，同时在警告里指向
  `--no-prompt-cache-1h`。
- 仍然拒绝这个参数的客户端会让这一轮以 `fatal` 结束，附带供应商的消息和指向该设置的提示，而且这个
  拒绝绝不重试。连通性测试会带上弹窗当前的开关值，所以在保存模型之前就能看到拒绝结果。
- 后台请求——Session 标题生成和 `read_file` 的视觉代理读取——保持默认的保留时间，只有对话本身的
  请求才会申请一小时。
- Session 请求经由 `buildUniConfig` 携带这个标注：`promptCache1h` 设置
  `uniConfig.prompt_caching = PromptCaching.ENHANCE`；生成式模型把点名 `prompt_caching` 的
  `UnsupportedParameterError` 认作确定性的拒绝。
- 提示缓存模拟器把两种保留时间建模成互相独立的缓存，因此生命周期场景同时覆盖了收益（十分钟后回来的
  用户，在标注下读回整个前缀，不标注则什么也读不到）和代价（切换标注要先付一次完整写入）。
