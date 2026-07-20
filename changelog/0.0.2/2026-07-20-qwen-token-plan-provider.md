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
  rest do not). Pricing and context windows come from each model's page at
  `www.qianwenai.com/models/<id>` (official CNY list prices; limited-time promotions are not
  stored): qwen3.7-max ¥2.4/¥12/¥36, qwen3.7-plus ¥0.4/¥2/¥8, glm-5.2 ¥2/¥8/¥28,
  deepseek-v4-pro ¥1/¥12/¥24 (cache-hit/input/output per M tokens), windows 1M (glm-5.2:
  1.04M). qwen3.8-max-preview is preview-only with a quota-multiplier promotion and no
  per-token list price, so it alone carries no pricing (costs read as 0, same as unpriced
  user models); the pricing invariant in the catalog tests is scoped to that one entry.
- Catalog invariant updated: bare model ids may now repeat across providers (the gateway
  resells vendor models under their upstream ids, e.g. `glm-5.2` / `deepseek-v4-pro`);
  uniqueness is the `(provider, model_id)` pair, matching the catalog's sole lookup key.
- New provider logo: the official Qwen wordmark (icon + lettering) from the brand SVG,
  gradient fills flattened to currentColor monochrome, coordinates rounded to 2dp.
- Docs (models.en/zh) provider table and gateway notes updated.
