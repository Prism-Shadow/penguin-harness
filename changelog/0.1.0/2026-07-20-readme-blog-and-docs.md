# READMEs, blog, and docs site

## READMEs

The repository READMEs (en/zh).

### Restructure the README around the product story

The README now leads with the agents-build-agents pitch and community links, then three
feature showcases (benchmark chart, one-sentence RAG demo, self-evolution), followed by
changelog/blog/docs, supported models, human-first installation, a roadmap, CONTRIBUTING,
a citation, and credits.

### Details

- New narrative header: "With LangChain, you build agents by hand — at 1x speed. With
  PenguinHarness, agents build agents — at 100x." with the subtitle "A zero-code CLI and
  Web UI, connected to 1000+ models," plus community links (Discord / X / WeChat).
- Feature 1 "Simple and Efficient": light/dark benchmark bar charts generated from the
  landing benchmark data (accuracy and cost per run vs Claude Code and OpenAI Codex, all
  driven by DeepSeek V4 Pro), committed as `assets/readme/benchmark-{light,dark}.svg`.
- Feature 2 "Build an Agent in One Sentence": the RAG one-sentence prompt plus a real
  product screenshot captured by the new `packages/landing/scripts/capture-readme-demo.mjs`
  (same real-server + mock-LLM pipeline as the landing shots), committed as
  `assets/readme/rag-demo-{light,dark}.webp`.
- Feature 3 "Self-Evolution": copy describing the evaluate-optimize-snapshot loop with an
  HTML-comment placeholder for the upcoming demo video.
- New sections: Changelog / Blog / Docs links, a supported-models table (DeepSeek V4,
  Kimi K3, GLM 5.2, Hunyuan 3, Qwen 3.8 Max, GPT 5.5, Gemini 3.5 Flash, Claude Opus 4.8
  with their providers, plus the 1000+-via-gateways note), Requirements and Installation
  split into "Web App — for humans" and "CLI & SDK — for agents", a Roadmap (benchmark
  suite release), a BibTeX citation ({PrismShadow Team}), and the license/credits footer.
- New `CONTRIBUTING.md` absorbs the developer content: dev commands, repo layout table,
  quality gates, the English-only and changelog working rules, and the README-asset
  regeneration notes; the README's Development section now points there.
- `README.zh.md` mirrors the new structure in Chinese.

### Refresh the README model table against the current catalog

The supported-models table (the same eight models) becomes two columns — model on the
left, the comma-separated providers it's available from on the right (per today's catalog)
— and the note below now names all five OpenAI-compatible gateways.

### Details

- Availability per the catalog: DeepSeek V4 in five groups, GLM 5.2 in six, Kimi K3 via
  OpenRouter and Qwen Pay-As-You-Go, Qwen 3.8 Max as the Token Plan preview, GPT 5.5 and
  Claude Opus 4.8 native + OpenRouter, Hunyuan 3 via OpenRouter, Gemini 3.5 Flash native.
- The gateway note lists OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, and
  Qwen Pay-As-You-Go. README.zh.md mirrors.

### Split badge rows and showcase the finished RAG app

The site badges (Website / Docs / Blog) and the community badges (Discord / X / WeChat) now sit on separate lines. The one-sentence example becomes the condensed claude-code-docs configuration-expert prompt (the chat page's example task carries the full version), and the demo image shows the FINISHED PRODUCT — the generated docs-expert app with cited clickable sources and example questions (`assets/readme/rag-app-<lang>-<theme>.webp`, per-language shots; the zh README shows the Chinese prompt and shots) — instead of the PenguinHarness chat UI. The mockup renderer (`rag-app-mockup.html` + rewritten `capture-readme-demo.mjs`, no server needed) comes along so the assets stay regenerable.

## Blog and docs site

Blog posts and the docs site.

### Announcement bar, AMD Fireworks-credits blog post, and the GDPevo launch story

The site gains a rotating announcement bar, a new campaign post, and a launch post that finally tells the whole story.

- **Announcement bar** — a switchable bar above the nav (auto-rotates every 6s, paused on hover, prev/next chevrons): entry 1 announces Kimi K3 and Qwen 3.8 Max availability (links to the models docs), entry 2 the $50 Fireworks credits campaign (links to the new post). Bilingual, on every page, scrolls away with the page.
- **New blog post `fireworks-credits-amd` (en/zh)** — announces the AMD AI Developer Program partnership bringing free Fireworks redemption codes: step-by-step application (join ADP, Member Perks, form with Fireworks AI selected, review, coupon email, redeem + API key, screenshots adapted from WhatGhost's guides with credit), then a three-step PenguinHarness setup (install, Fireworks group bulk-key + presets + speed test, run).
- **Launch post rewrite (en/zh)** — now opens with the GDPevo origin story: self-evolution was validated in the team's GDPevo Benchmark (linked), and bringing it to everyone is why PenguinHarness exists. The rest mirrors the README: three numbered reasons with the benchmark chart and RAG demo images (served from the site's own /blog-assets/), the security contract, the models table with the any-OpenAI-protocol note, install/usage steps, the roadmap (benchmark suite, desktop app, Windows), and a closing community call-to-action (Discord / X / WeChat / GitHub).

### The launch post settles on the numbered three-reasons structure

The launch blog post (en/zh) keeps the GDPevo origin story and the numbered "Why PenguinHarness" structure — ### 1 better on complex tasks at lower cost (benchmark chart + tables), ### 2 one-sentence Agent-builds-your-app (prompt + demo shot), ### 3 self-evolution — followed by the security contract, the models table, a Web-only "How to use it" (install + penguin web + Models page; no CLI commands), the roadmap, and the community call-to-action.

### The launch post shows the finished RAG app with the condensed prompt

The one-sentence build section now uses the condensed claude-code-docs configuration-expert prompt (Chinese in the zh post) and the finished-product screenshot of the generated docs-expert app (per-language, served from /blog-assets/), replacing the PenguinHarness chat capture.
