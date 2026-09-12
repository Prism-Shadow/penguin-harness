# Every OpenRouter model speaks the Responses API

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `docs`, `model-catalog`
- **PR:** [#705](https://github.com/Prism-Shadow/penguin-harness/pull/705)

[中文版](2026-09-12-catalog-openrouter-responses.zh.md)

Every OpenRouter preset in the built-in catalog moved to AgentHub's generic Responses client
(`client_type = "openai-responses"`), and the OpenRouter provider group pins the same protocol,
so a model added to that group by hand speaks it too.

## Details

- All 43 OpenRouter catalog rows pin `openai-responses`. Only the ten `openai/*` rows did
  before; the rest carried `openai-chat`. The preset base URL is unchanged — OpenRouter serves
  the Responses API at `{base}/responses` for every upstream it resells.
- The `openrouter` entry in `MODEL_PROVIDERS` gained a group-level `clientType`, the mechanism
  the vLLM group already used. `penguin config model add --provider openrouter` and the Web
  App's add-model dialog write `openai-responses` for an id that has no catalog row of its own.
- The add-model dialog's protocol note separates a gateway that pins a protocol from a
  self-hosted group that pins one: for OpenRouter it says the base URL is already preset to the
  gateway's endpoint, instead of asking for the address of the user's own server.
- The models documentation was rewritten in both languages.
- Existing Projects keep what they stored. Presets are copied into `.project_config.toml` when
  the Project is created and nothing rewrites them, so stored OpenRouter rows stay on
  `openai-chat` until their owner presses **sync presets** on the models page, which rewrites
  the catalog-owned fields — the protocol among them — and leaves credentials alone. Until
  then the sync badge counts those rows.
