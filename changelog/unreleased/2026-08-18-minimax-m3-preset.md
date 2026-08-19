# Built-in MiniMax M3 model preset

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `web`, `docs`, `model-catalog`
- **PR:** [#167](https://github.com/Prism-Shadow/penguin-harness/pull/167)

[中文版](2026-08-18-minimax-m3-preset.zh.md)

The built-in model catalog gains a MiniMax provider group with one direct `MiniMax-M3` preset, ready to use with only an API key.

## Core

The new `minimax` group (label "MiniMax", listed between Moonshot and Custom) carries `MiniMax-M3` with a 1,000,000-token context window and vision support. The preset pins AgentHub's `minimax-m3` Responses client and inlines the direct endpoint `https://api.minimax.io/v1`, so it holds no secret. MiniMax serves both billing modes from that one endpoint — the group's key link points at the pay-as-you-go API key page, and a Token Plan Subscription Key works just as well — so it is a single `minimax` group rather than the per-billing-mode split the Qwen groups need.

Pricing records MiniMax's standard pay-as-you-go tier at 512K input tokens or below — $0.06 cache read / $0.30 input / $1.20 output per million tokens. Every rate doubles above 512K and the priority tier is 1.5x, so long-context and priority usage is underestimated; that is the base-tier convention the catalog already applies to OpenAI (>272K) and Gemini 3.1 Pro (>200K). Env-var fallback mirrors AgentHub's exact routing: only `MiniMax-M3` with the `minimax-m3` client resolves to `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`; lookalike and unsupported MiniMax ids remain unroutable.

Core and CLI move to `@prismshadow/agenthub` ^0.4.2, the first release that ships the `minimax-m3` Responses client.

## Web App

The provider logo set gains MiniMax's official stream-lines mark, flattened to currentColor monochrome — the same recognition-purposes treatment as the other vendor brand marks. The model dialog's base-URL protocol hint knows the M3 client posts to `{base}/responses` rather than the `/chat/completions` every other non-OpenAI, non-Anthropic, non-Gemini client uses.

## Docs

The bilingual model and configuration pages document the new group, its credential resolution, omitted tiered pricing, and the M3 thinking mapping where `none` becomes `reasoning.effort = "none"`.
