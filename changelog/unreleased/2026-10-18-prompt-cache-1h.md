# A model can keep its prompt cache for an hour

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `web`, `docs`
- **PR:** [#1211](https://github.com/Prism-Shadow/penguin-harness/pull/1211)

[中文版](2026-10-18-prompt-cache-1h.zh.md)

A model entry can now ask for a one-hour prompt cache instead of the provider's default five
minutes. Writing `prompt_cache_1h = true` into `.project_config.toml`, turning on the **1-hour
cache** switch in the Web model dialog, or passing `--prompt-cache-1h` to `penguin config model
add` makes the model's Session requests send MMSP `prompt_caching = enhance`, which the Anthropic
protocol client turns into `cache_control: { type: "ephemeral", ttl: "1h" }`. A conversation picked
up after a break longer than five minutes then reads its whole prefix from the provider's cache
instead of paying for it again.

## Details

- The annotation lives on the model entry and, like `fast_mode`, only `true` is persisted: an
  omitted field or `false` clears it, and an update that does not mention it keeps the stored
  value. A hand-edited `prompt_cache_1h = false` stays off and is normalized away on the next
  write.
- Only a model routed to MMSP's `anthropic-official` client can carry it. Routing follows the
  entry's `client_type`, then the group's, then the vendor family its `model_id` begins with
  (`claude-`). The Web dialog offers the switch only there, and keeps it for an entry that already
  stores `true` on an unsupported route so it can be turned off; the CLI writes the entry and
  prints a warning pointing at `--no-prompt-cache-1h`.
- A client that still rejects the parameter ends that turn `fatal` with the provider's message and
  the setting's guidance, and the rejection is never retried. The connection test sends the
  dialog's current switch, so it shows the rejection before the model is saved.
- Background requests — Session title generation and `read_file`'s proxy vision reads — stay on the
  default lifetime. Only the conversation's own requests ask for the hour.
- The Session request carries the annotation through `buildUniConfig`, where `promptCache1h` sets
  `uniConfig.prompt_caching = PromptCaching.ENHANCE`; the generative model recognizes an
  `UnsupportedParameterError` naming `prompt_caching` as the deterministic refusal.
- The prompt-cache simulator models the two lifetimes as separate caches, so a lifecycle scenario
  covers both the saving (a user back after ten minutes reads the whole prefix under the
  annotation, and nothing without it) and its cost (switching the annotation pays one full write).
