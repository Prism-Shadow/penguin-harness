# Built-in MiniMax M-series model presets

The built-in model catalog gains a MiniMax provider group with three direct M-series presets, ready to use with only an API key.

## Core

The new `minimax-token-plan` group (label "MiniMax", listed between Moonshot and Custom) carries `MiniMax-M3` (1,000,000-token context, vision), `MiniMax-M2.7`, and `MiniMax-M2.7-highspeed` (204,800-token context, text-only). All three pin AgentHub's shared `minimax-m3` protocol client and inline the direct endpoint `https://api.minimax.io/v1`, so the entries hold no secrets and accept either a Token Plan Subscription Key or a pay-as-you-go API key. Pricing records MiniMax's official USD base tier (M3 publishes a higher tier above 512K input tokens; the cost center's single-rate schema keeps the base tier, matching the existing OpenAI and Gemini long-context treatment).

Env-var fallback resolution now mirrors AgentHub's exact-match MiniMax routing: the `minimax-m3` protocol, and the bare `MiniMax-M2.7` / `MiniMax-M2.7-highspeed` ids without an explicit client type, resolve to `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`; unknown MiniMax-like ids (e.g. `MiniMax-M2.5`) stay unroutable, exactly as AgentHub would reject them.

Requires `@prismshadow/agenthub` >= 0.4.2, the first release that ships the `minimax-m3` Responses client.

## Web App

The provider logo set gains MiniMax's official stream-lines mark, flattened to currentColor monochrome — the same recognition-purposes treatment as the other vendor brand marks.

## Docs

The bilingual model and configuration pages document the new group, its credential resolution, and the thinking-level mapping: both M2.7 variants cannot disable reasoning, so `none` degrades to `low`; M3 preserves `none`.
