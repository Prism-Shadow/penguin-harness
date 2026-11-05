# 压缩请求按会话的思考等级发出

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `core`
- **PR:** [#700](https://github.com/Prism-Shadow/penguin-harness/pull/700)

[English](2026-09-11-compaction-thinking-level.md)

## 细节

- 思考等级是每请求参数，每次 LLM 请求都取 Session 钉住的等级——对话工具条的选择器、CLI 的
  `--thinking` / `/thinking`、SDK 的 `session.thinkingLevel`——未钉住时才回退到上下文开启时读到的
  等级。压缩请求此前是个例外、恒取回退值，于是一个「钉住的等级与上下文基准档不同」的会话，普通轮跑在
  一个等级上、压缩轮跑在另一个等级上。现在它与其他请求一样携带该等级。
- 这条例外的用意，是让压缩请求的前缀与它所压缩的那个上下文保持一致，从而在「缓存未命中代价最大」的
  时刻保住 provider 的缓存。但它只可能在用户已经改过等级时才触发——而那时其后的每一轮早已按新等级
  发出、缓存也已按新等级重建，反倒是按基准档发出的压缩请求成了唯一不一致的那次。
- 这个分裂真正的代价是：在把等级读作思考模式的 provider 那里，它意味着思考模式在对话中途变动。在安静
  档下产出的那一轮不带思考内容，而 DeepSeek 会拒绝「当前工具调用链里回放了这样一轮」的请求。
- `specs/05-ARCHITECTURE.md`「上下文轮换与运行配置」一节原本写有这条例外，配套设计改动见
  [penguin-harness-design #149](https://github.com/Prism-Shadow/penguin-harness-design/pull/149)。
