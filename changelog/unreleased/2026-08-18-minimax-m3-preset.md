# Built-in MiniMax M3 model preset

The built-in model catalog gains a MiniMax provider group with one direct `MiniMax-M3` preset, ready to use with only an API key.

## Core

The new `minimax-token-plan` group (label "MiniMax", listed between Moonshot and Custom) carries `MiniMax-M3` with a 1,000,000-token context window and vision support. The preset pins AgentHub's `minimax-m3` Responses client and inlines the direct endpoint `https://api.minimax.io/v1`, so it holds no secret and accepts either a Token Plan Subscription Key or a pay-as-you-go API key.

Pricing is omitted because MiniMax doubles cache-read, input, and output rates above 512K input tokens, while the catalog cannot represent tiered pricing. Env-var fallback mirrors AgentHub's exact routing: only `MiniMax-M3` with the `minimax-m3` client resolves to `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`; lookalike and unsupported MiniMax ids remain unroutable.

Requires `@prismshadow/agenthub` >= 0.4.2, the first release that ships the `minimax-m3` Responses client.

## Web App

The provider logo set gains MiniMax's official stream-lines mark, flattened to currentColor monochrome — the same recognition-purposes treatment as the other vendor brand marks.

## Docs

The bilingual model and configuration pages document the new group, its credential resolution, omitted tiered pricing, and the M3 thinking mapping where `none` becomes `reasoning.effort = "none"`.
