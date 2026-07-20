# Add the Fireworks AI provider group

An OpenAI-protocol gateway group below OpenRouter with five preset models (GLM-5.2,
Kimi K2.7 Code, DeepSeek V4 Pro, MiniMax M3, DeepSeek V4 Flash), priced from each model's
Fireworks page.

## Details

- New provider `fireworks` ("Fireworks AI") right after OpenRouter in the gateway cluster:
  preset base URL `https://api.fireworks.ai/inference/v1`, API-key page
  `https://app.fireworks.ai/settings/users/api-keys`, models page
  `https://app.fireworks.ai/models`; `OPENAI_*` env fallback like the other gateways.
- Five entries (`client_type: openai` + inlined endpoint) with standard-serverless USD
  pricing (cached input / uncached input / output per M tokens) and specs from each page:
  glm-5p2 $0.14/$1.40/$4.40 (1M), kimi-k2p7-code $0.19/$0.95/$4.00 (262K, vision),
  deepseek-v4-pro $0.15/$1.74/$3.48 (1M), minimax-m3 $0.06/$0.30/$1.20 (512K, vision),
  deepseek-v4-flash $0.03/$0.14/$0.28 (1M). API model ids use Fireworks' full
  `accounts/fireworks/models/<slug>` form (sent verbatim).
- `modelHomepageUrl` maps the `accounts/<owner>/models/<slug>` id to the model page
  (`app.fireworks.ai/models/<owner>/<slug>`), falling back to the models listing for
  nonconforming user-added ids. A simplified starburst glyph approximates the brand mark
  (same approach as Z.AI). Docs (models.en/zh) provider tables and gateway notes updated.
