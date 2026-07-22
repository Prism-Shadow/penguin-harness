# Sites: one navbar, a richer blog, and the AI-app skills story

## The docs and landing navbars are identical

The two sites' navbars differed in container width (6xl vs 7xl), the docs-only badge pill, hamburger placement and a broken menu animation class. Both now share the same `max-w-7xl` container (the landing footer aligned to match, framing nav and footer consistently while content sections stay 6xl), the same logo block, and the same right-cluster layout; the landing language menu's undefined `anim-pop` class was replaced with the working `anim-fade`. Cross-SPA link semantics and each site's mobile behavior stay as they were.

## Blog grouping, pinned posts, and page metadata

The blog list groups posts under category headers (Product news, then Release notes) in the "All" view, and posts can be pinned to the top of their group via `pinned: true` frontmatter — the AMD local-agents post is pinned. The detail page moves its metadata below the title: a locale-formatted date ("July 20, 2026" / "2026年7月20日"), the author line (frontmatter `author`, defaulting to Yaowei Zheng (PrismShadow AI)), and a copy-page-link button with clipboard fallback and a transient "Copied" state.

## AI App Development skills, front and center

The READMEs (both languages) and the landing page now say explicitly what powers the one-sentence-to-app flow: the built-in AI App Development skill group — Penguin SDK, Penguin CLI and AgentHub model APIs, plus local serving and fine-tuning via vLLM, Ollama and LLaMA-Factory — letting PenguinHarness build and tune AI applications end to end, fully automatically.
