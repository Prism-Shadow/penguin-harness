# Unified site navigation and homepage Harness OS & self-evolution redesign

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `ui`, `web`, `landing`, `docs`, `ui-gallery`
- **PR:** [#1853](https://github.com/Prism-Shadow/penguin-harness/pull/1853)

[中文版](2026-11-25-landing-agent-os-and-evolution-redesign.zh.md)

The public sites (`landing`, `docs`, and `ui-gallery`) now share one `SiteNav` and `SiteMobileNav` implementation from `@prismshadow/penguin-ui/site`, with RFCs grouped inside the More menu. Both the Web App start page and the homepage now present `Harness OS`: on the homepage, the hero catalogue displays `1000+` supported models, `10+` RSI algorithms, and `20+` Benchmarks under the updated subtitle. The Harness OS section showed the App Center as a home screen that kept filling as one-sentence A2APP requests generated and installed apps side by side, and the Self-Evolution Platform section put several tested agents, each going round its own evaluate-and-improve loop under one Optimizer and its Evaluators, into one workbench with the accuracy, cost and duration trends, which advanced each time a loop closed a round.
