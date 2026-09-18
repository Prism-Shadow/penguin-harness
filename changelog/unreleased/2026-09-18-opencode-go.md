# OpenCode Go: a built-in model group, listed after TokenDance and Penguin Go

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#786](https://github.com/Prism-Shadow/penguin-harness/pull/786)

[中文版](2026-09-18-opencode-go.zh.md)

The model catalog gained an **OpenCode Go** group (`opencode-go`) holding the 27 models OpenCode lists for its Go subscription. By default the Models page lists it third: TokenDance, Penguin Go, OpenCode Go, DeepSeek, then the other groups in their previous order.

## Details

- Each row pins the protocol OpenCode's endpoint table gives its model. 16 rows use `openai-chat` and 4 use `openai-responses`, all at `https://opencode.ai/zen/go/v1`. The other 7 use `ant-messages` at `https://opencode.ai/zen/go`, because the Anthropic client appends `/v1/messages` itself. A model added to the group by hand gets `openai-chat` and the `/v1` base URL.
- With the key left blank, the Chat Completions and Responses rows read `OPENAI_API_KEY` and the Messages rows read `ANTHROPIC_API_KEY`.
- Prices are the per-token rates on OpenCode's Go page, in USD. Go is a monthly subscription whose usage limits are dollar amounts, so for this group the cost center shows allowance used. `gpt-5.6-luna`, `grok-4.6`, `qwen3.7-plus` and `qwen3.6-plus` store their base tier. The four DeepSeek rows store the peak rate and follow DeepSeek's off-peak schedule. No row carries a promotion.
- Context windows and image input come from models.dev, the model registry OpenCode maintains. 16 rows accept images and 11 are text only.
- `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor` answer 403 until the key's OpenCode workspace consents to Meta training on prompts and completions. `deepseek-v4.1-flash`, `deepseek-v4-flash` and `deepseek-v4-pro` answer 403 until it consents to China-hosted serving. From mainland China, `gpt-5.6-luna` and both Muse Spark models answer 403 for the caller's region.
- Requests to the group carry `x-opencode-session`, since its endpoints are on `opencode.ai`.
- The group's glyph is the pixel "G" of OpenCode Go's wordmark.
- The models docs gained a section on the group, and the configuration docs list its environment variables.
- Existing Projects pick the group up through "Sync presets" on the Models page. A Project whose groups were dragged into a custom order keeps that order, and the new group comes after the groups it names.
