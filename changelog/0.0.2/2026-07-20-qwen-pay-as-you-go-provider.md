# Add the Qwen Pay-As-You-Go provider group

A pay-per-token gateway group below Qwen Token Plan (DashScope's OpenAI-compatible
endpoint) with four preset models — qwen3.7-max, qwen3.7-plus, and the resold
vendor-prefixed kimi/kimi-k3 and ZHIPU/GLM-5.2 — priced from each model's official page.

## Details

- New provider `qwen-pay-as-you-go` ("Qwen Pay-As-You-Go") right after Qwen Token Plan in
  the gateway cluster: preset base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`,
  API-key link `https://platform.qianwenai.com/docs/api-reference/preparation/api-key`,
  models page `https://www.qianwenai.com/models`; `OPENAI_*` env fallback like the other
  gateways.
- Four entries (`client_type: openai` + inlined endpoint), official CNY list prices and
  specs from each model's page: kimi/kimi-k3 ¥2/¥20/¥100 (1.04M, vision), qwen3.7-max
  ¥2.4/¥12/¥36 (1M), ZHIPU/GLM-5.2 ¥2/¥8/¥28 (1.04M), qwen3.7-plus ¥0.4/¥2/¥8 (1M,
  vision). Resold third-party models keep their vendor-prefixed upstream ids.
- The group shares the Qwen emblem (glyph extracted into a shared constant), and
  `modelHomepageUrl` URL-encodes the slash-prefixed ids
  (`.../models/ZHIPU%2FGLM-5.2`). Docs (models.en/zh) provider tables and gateway notes
  updated.
