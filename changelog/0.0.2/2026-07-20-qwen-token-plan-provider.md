# Add the Qwen Token Plan provider group to the model catalog

The built-in catalog gains a Qwen Token Plan subscription gateway group (OpenAI-compatible,
preset base URL) with five models — qwen3.8-max-preview, qwen3.7-max, qwen3.7-plus, glm-5.2,
and deepseek-v4-pro — plus a custom provider logo.

## Details

- New provider `qwen-token-plan` ("Qwen Token Plan"), placed with the gateway cluster after
  SiliconFlow: OpenAI-compatible endpoint preset to
  `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`, API-key page
  `https://platform.qianwenai.com/pricing/token-plan`, model-id docs page
  `https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview`;
  env fallback is `OPENAI_API_KEY`/`OPENAI_BASE_URL` like the other gateways.
- Five catalog entries with `client_type: openai` and the inlined base URL. Vision flags per
  the plan's supported-model table (qwen3.8-max-preview and qwen3.7-plus see images; the
  rest do not). The plan is a subscription quota — there is no per-token price — so the
  entries carry no pricing and costs read as 0 (same as unpriced user models); the pricing
  invariant in the catalog tests is scoped accordingly. Context windows: the Qwen trio uses
  the Qwen Max series' published 256K until the plan documents its own; the cross-listed
  GLM/DeepSeek entries mirror the vendors' native 1M windows.
- Catalog invariant updated: bare model ids may now repeat across providers (the gateway
  resells vendor models under their upstream ids, e.g. `glm-5.2` / `deepseek-v4-pro`);
  uniqueness is the `(provider, model_id)` pair, matching the catalog's sole lookup key.
- New provider logo: six separated petals radiating hexagonally — a simplified geometric
  approximation of the faceted Qwen emblem (same approach as the Z.AI glyph).
- Docs (models.en/zh) provider table and gateway notes updated.
