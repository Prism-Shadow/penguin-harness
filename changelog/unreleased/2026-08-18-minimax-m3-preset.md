# Built-in MiniMax M3 model preset

The built-in model catalog gains a MiniMax provider group with one direct `MiniMax-M3` preset, ready to use with only an API key.

## Core

The new `minimax` group (label "MiniMax", listed between Moonshot and Custom) carries `MiniMax-M3` with a 1,000,000-token context window and vision support. The preset pins AgentHub's `minimax-m3` Responses client and inlines the direct endpoint `https://api.minimax.io/v1`, so it holds no secret. MiniMax serves both billing modes from that one endpoint — the group's key link points at the pay-as-you-go API key page, and a Token Plan Subscription Key works just as well — so it is a single `minimax` group rather than the per-billing-mode split the Qwen groups need.

Pricing is omitted because MiniMax doubles cache-read, input, and output rates above 512K input tokens, while the catalog cannot represent tiered pricing. Env-var fallback mirrors AgentHub's exact routing: only `MiniMax-M3` with the `minimax-m3` client resolves to `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`; lookalike and unsupported MiniMax ids remain unroutable.

Core and CLI move to `@prismshadow/agenthub` ^0.4.2, the first release that ships the `minimax-m3` Responses client.

## Web App

The provider logo set gains MiniMax's official stream-lines mark, flattened to currentColor monochrome — the same recognition-purposes treatment as the other vendor brand marks. The model dialog's base-URL protocol hint knows the M3 client posts to `{base}/responses` rather than the `/chat/completions` every other non-OpenAI, non-Anthropic, non-Gemini client uses.

## Docs

The bilingual model and configuration pages document the new group, its credential resolution, omitted tiered pricing, and the M3 thinking mapping where `none` becomes `reasoning.effort = "none"`.
