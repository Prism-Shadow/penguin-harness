# Blog and docs site

Blog posts and the docs site.

## Announcement bar, AMD Fireworks-credits blog post, and the GDPevo launch story

The site gains a rotating announcement bar, a new campaign post, and a launch post that finally tells the whole story.

- **Announcement bar** — a switchable bar above the nav (auto-rotates every 6s, paused on hover, prev/next chevrons): entry 1 announces Kimi K3 and Qwen 3.8 Max availability (links to the models docs), entry 2 the $50 Fireworks credits campaign (links to the new post). Bilingual, on every page, scrolls away with the page.
- **New blog post `fireworks-credits-amd` (en/zh)** — announces the AMD AI Developer Program partnership bringing free Fireworks redemption codes: step-by-step application (join ADP, Member Perks, form with Fireworks AI selected, review, coupon email, redeem + API key, screenshots adapted from WhatGhost's guides with credit), then a three-step PenguinHarness setup (install, Fireworks group bulk-key + presets + speed test, run).
- **Launch post rewrite (en/zh)** — now opens with the GDPevo origin story: self-evolution was validated in the team's GDPevo Benchmark (linked), and bringing it to everyone is why PenguinHarness exists. The rest mirrors the README: three numbered reasons with the benchmark chart and RAG demo images (served from the site's own /blog-assets/), the security contract, the models table with the any-OpenAI-protocol note, install/usage steps, the roadmap (benchmark suite, desktop app, Windows), and a closing community call-to-action (Discord / X / WeChat / GitHub).

## The launch post settles on the numbered three-reasons structure

The launch blog post (en/zh) keeps the GDPevo origin story and the numbered "Why PenguinHarness" structure — ### 1 better on complex tasks at lower cost (benchmark chart + tables), ### 2 one-sentence Agent-builds-your-app (prompt + demo shot), ### 3 self-evolution — followed by the security contract, the models table, a Web-only "How to use it" (install + penguin web + Models page; no CLI commands), the roadmap, and the community call-to-action.

## The launch post shows the finished RAG app with the condensed prompt

The one-sentence build section now uses the condensed claude-code-docs configuration-expert prompt (Chinese in the zh post) and the finished-product screenshot of the generated docs-expert app (per-language, served from /blog-assets/), replacing the PenguinHarness chat capture.
