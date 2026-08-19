# Docs: the Tools and Configuration references match the code again

- **Date:** 2026-07-30
- **Type:** process
- **Scope:** `docs`
- **PR:** [#126](https://github.com/Prism-Shadow/penguin-harness/pull/126)

[中文版](2026-07-30-docs-tools-and-configuration-reference.zh.md)

Three reference blocks had fallen behind the codes they document

`run_subagent`'s argument block listed `model_id` alone, though a model is always referenced by the complete `(provider, model_id)` pair: the tool schema declares both and rejects a call carrying only one, and the page's own prose already said as much. Only the code block was stale, and it is the part a reader copies — both language editions now list `provider` beside `model_id`.

The provider credential table covered nine of the twelve groups in `MODEL_PROVIDERS`, omitting the `fireworks`, `qwen-token-plan` and `qwen-pay-as-you-go` gateways. All three read `OPENAI_API_KEY` / `OPENAI_BASE_URL`, for the same reason `openrouter` and `siliconflow` were already on that row: a gateway's model ids cannot be auto-routed, so its entries go through the OpenAI client. For a group missing from the table the natural guess is wrong twice over, since neither a vendor-shaped `FIREWORKS_API_KEY` nor the variable of the vendor whose model the gateway resells is ever read.

The Project model entry table skipped `max_tokens`, the per-model output cap that overrides the Agent's `model.max_tokens` when set. It is what makes a narrow-context model usable at all — the seeded Agent default of 32000 cannot fit a small window alongside any prompt, and the upstream rejects such a request outright — and the CLI reference already documented the flag that writes it.
