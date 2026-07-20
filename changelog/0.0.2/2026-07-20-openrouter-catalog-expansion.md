# Expand the OpenRouter catalog with twelve models

The OpenRouter gateway group grows from 4 to 16 entries, adding the current flagship and
free tiers with pricing, context windows, and vision flags taken from each model's
OpenRouter page.

## Details

- Added (ordered by output price): anthropic/claude-fable-5 ($10/$50), openai/gpt-5.6-sol
  ($5/$30), openai/gpt-5.5 ($5/$30), anthropic/claude-opus-4.8 ($5/$25),
  anthropic/claude-opus-4.7 ($5/$25), moonshotai/kimi-k3 ($3/$15), openai/gpt-5.6-terra
  ($2.50/$15), anthropic/claude-sonnet-5 ($2/$10), z-ai/glm-5.2 ($0.93/$3),
  deepseek/deepseek-v4-pro ($0.435/$0.87), deepseek/deepseek-v4-flash ($0.09/$0.18), and
  nvidia/nemotron-3-ultra-550b-a55b:free (input/output per M tokens; all 1M context).
- Vision per the pages: the Claude models, GPT-5.5, and Kimi K3 accept image input; the
  rest do not.
- None of these pages list cache pricing, so cache_read carries the standard input price
  (no discount). The :free tier stores a genuine $0 price — not "unknown" — so costs
  correctly compute to 0; the catalog pricing invariant gains a free-tier case.
