# Sites: one navbar, a richer blog, and the built-in Skills listed

## The docs and landing navbars are identical

The two sites' navbars differed in container width (6xl vs 7xl), the docs-only badge pill, hamburger placement and a broken menu animation class. Both now share the same `max-w-7xl` container (the landing footer aligned to match, framing nav and footer consistently while content sections stay 6xl), the same logo block, and the same right-cluster layout; the landing language menu's undefined `anim-pop` class was replaced with the working `anim-fade`. Cross-SPA link semantics and each site's mobile behavior stay as they were.

## Blog categories, pinned posts, and page metadata

The blog list stays a single flat list with category badges and filter chips, now across three categories — Product news, Release notes, and the new Tech practice, which the AMD local-agents post moved into. Posts can be pinned to the top via `pinned: true` frontmatter; the launch post introducing PenguinHarness is pinned. A second practice post joined the blog: implementing agent self-improvement with PenguinHarness on an AMD GPU (en + zh), adopted into the same category and author conventions. The detail page moves its metadata below the title: a locale-formatted date ("July 20, 2026" / "2026年7月20日"), the author line (frontmatter `author`, defaulting to Yaowei Zheng (PrismShadow AI)), and a copy-page-link button with a safe clipboard fallback and a transient "Copied" state.

## The built-in Skills, listed where people look

The READMEs (both languages) gain a compact Built-in Skills section — one table of the four skill groups and their members — and the landing page gains a matching Skills section of group cards between Features and Security. The lists cover what currently ships and grow as new skills land — refreshed in this release to include the vLLM/Ollama serving and LlamaFactory fine-tuning skills once they landed.
