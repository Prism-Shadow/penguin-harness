# Qwen 3.8 Flash joins the TokenDance group

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `core`

[中文版](2026-08-27-catalog-tokendance-qwen38-flash.zh.md)

The built-in catalog now carries `qwen3.8-flash` under TokenDance, at that gateway's own rates:
CNY 0.8 input, 2.7 output, 0.1 cache hit per million tokens, over a 1M-token context window, with
image input.

The same upstream id already sat in the Qwen pay-as-you-go group at Qwen's direct list price
(CNY 1 / 3 / 0.1). Both rows stay: one model reached two ways, priced by whoever is selling it,
and the gateway is the cheaper of the two on input and output.

## Details

- Context window and the vision flag come from TokenDance's public catalog API
  (`GET https://tokendance.space/gateway/v1/models`, no credential required), the same source
  the rest of the group is verified against.
- The row is not discounted: its catalog `description` carries no bracketed 限时 tag, unlike
  `qwen3.8-max` in the same group, so its list price and its billed rate coincide.
- It advertises the widest protocol set in the group — `openai:chat-completions`,
  `openai:responses` and `anthropic:messages`. The `openai-chat` pin is this group's convention
  rather than a constraint of the id, which the entry says so nobody later reads it as forced.
- `cache_write` carries the input price, the convention the whole TokenDance block already runs
  on: the gateway publishes an input price and a cache-hit price with no separate cache-write fee.
