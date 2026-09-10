# DeepSeek V4.1 Flash ships as `deepseek-flash` and becomes the default model

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `core`, `cli`, `docs`, `skills`
- **PR:** [#662](https://github.com/Prism-Shadow/penguin-harness/pull/662)

[中文版](2026-09-10-model-catalog-deepseek-flash.zh.md)

DeepSeek released V4.1 Flash and names it `deepseek-flash`, without a version segment. The row
pre-registered under the announced spelling `deepseek-v4.1-flash` is replaced by the released one,
which now leads the `deepseek` group and is the model a new Project starts on. The same read
brought in the resold V4.1 Flash rows on TokenDance and OpenRouter, and TokenDance's current
promotion rates and Doubao Seed display names.

## The DeepSeek group

- `deepseek-flash` (**DeepSeek V4.1 Flash**) replaces the pre-registered `deepseek-v4.1-flash`:
  a 1,000,000-token context window, image input, and the Flash series peak price CNY 0.04 / 2 / 8
  per million tokens (cache hit / cache miss / output) on the schedule that halves every bucket
  outside Beijing weekday 09:00–12:00 and 14:00–18:00.
- That row is the one direct-vendor row in the group to pin a client and a base URL
  (`client_type = "deepseek-v4"`, `base_url = "https://api.deepseek.com"`). AgentHub 0.4.11 routes
  DeepSeek on the raw substring `deepseek-v4` and looks at nothing else, so the released bare id
  matches no client on its own. The pin comes off once AgentHub routes the name itself.
- `deepseek-v4-flash` is now marked as reading images. DeepSeek retired the model on 2026-09-10 and
  serves the id from V4.1 Flash at the Flash price, so what answers there is a model with image
  input. **AgentHub 0.4.11 still refuses image parts for this bare id** — its DeepSeek client
  carries a text-only deny-list written before the retirement — so until AgentHub relaxes that list
  an image sent to `deepseek-v4-flash` is rejected by the client rather than by DeepSeek. Send
  images to `deepseek-flash` meanwhile.
- `deepseek-v4-flash-vision-exp` was retired on the same announcement and is likewise served from
  V4.1 Flash; its image-input flag was already set and is unchanged.
- `deepseek-v4-pro` keeps the V4 Pro list price CNY 0.3 / 9 / 27 and its text-only flag. From 12:00
  Beijing on 2026-09-14, and until V4.1 Pro is released, DeepSeek routes requests for that id to
  V4.1 Flash and bills them at the V4.1 Flash price; the row records what the vendor publishes for
  `deepseek-v4-pro` itself, so it is left as it is.

## The default model

- A new Project's `default_model` is now `deepseek` / `deepseek-flash`. Its preset entry carries
  the row's pinned client and endpoint, so the default is routable exactly as written.
- The documented first-run commands moved with it: `README.md`, `README.zh.md`, and the CLI, SDK
  and Docker quickstarts in both languages now pass `--model-id deepseek-flash`, as do the
  `default_model` line and the `[[models]]` sample it names in the configuration and models
  documents.

## The CLI inherits a preset's pin

`penguin config model add` now reads the built-in catalog row for the exact
`(provider, model_id)` pair it is given, and a **new** entry inherits that row's `client_type` and
`base_url` before the group rule is consulted. Without it,
`penguin config model add --provider deepseek --model-id deepseek-flash` into a Project that does
not already hold the row would write an entry AgentHub cannot route. An explicit `--client-type` or
`--base-url` still wins, and an existing entry is never rewritten.

## TokenDance

- `deepseek-v4.1-flash` (**DeepSeek V4.1 Flash**) joins the group: a 1,000,000-token context
  window and image input per the gateway's public catalog API, at CNY 0.04 / 2 / 8.
- Both DeepSeek Flash rows sold here — the new one and `deepseek-v4-flash-vision-exp` — follow the
  vendor's own peak/off-peak schedule rather than a flat gateway discount. `vision-exp` moved from
  a flat CNY 0.05 / 1.5 / 4.5 to the peak tier CNY 0.04 / 2 / 8 with the schedule declared.
- Promotion rates as of 2026-09-10, list prices unchanged: `deepseek-v4-flash-0731` and
  `deepseek-v4-pro-0813` are 20% off (from 50%), `glm-5.3-flash` is 10% off (its 50% ran through
  2026-09-09 24:00). `kimi-k3` stays at 20%, `glm-5.3` and `qwen3.8-max` at 10%, and the three
  Doubao Seed rows at 50%.
- The three Seed rows are displayed under the seller's own spelling: **Seed-2.1-Pro**,
  **Seed-2.1-Turbo**, **Seed-Evolving**.

## OpenRouter

`deepseek/deepseek-v4.1-flash` joins the group at the head of the DeepSeek run: a 1,048,576-token
context window, image input, and USD 0.006 / 0.3 / 1.2 per million tokens. That base price is the
peak tier — the listing's own `pricing.overrides` bill exactly half on weekends and outside weekday
UTC 01:00–04:00 / 06:00–10:00, which are DeepSeek's Beijing windows — so the row stores the peak
figures and declares the shared schedule, as the direct row does.

The stale sentence in the `deepseek/deepseek-v4-flash-vision-exp` row comment claiming it stored
the off-peak tier was corrected: the listing carries no overrides, and the row keeps the flat price
the API publishes.

## Existing Projects

Presets are copied into `.project_config.toml` when a Project is created and nothing rewrites them
afterwards, so nothing here reaches an existing Project on its own. The models page's **sync
presets** appends `deepseek-flash` and updates catalog-owned fields on the rows that moved; it
never deletes, so a dev-data Project created while `deepseek-v4.1-flash` was pre-registered keeps
that stale row until it is removed by hand, and it never touches the stored default — an existing
Project keeps whatever model it was already starting sessions on. Because prices moved and rows
were added, every existing Project shows the preset-update badge until it syncs or dismisses it.
