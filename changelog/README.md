# Changelog

Per-release update records, written in English. Each release version has its own folder, and
every change lands as a file named `<version>/YYYY-MM-DD-<semantic-id>.md` describing the
update, where `<version>` is the next unreleased version at the time the change is made
(folders of released versions are frozen). Each entry starts with an H1 title followed by a
one-sentence summary; this index lists every entry's title with that summary.

History starts after the v0.0.1 release (2026-07-19); v0.0.1 and earlier changes are not
backfilled.

## 0.0.2 (unreleased)

- [Make English the repository working language](0.0.2/2026-07-20-english-working-language.md) — Translated all residual non-i18n Chinese (comments, error/log messages, test titles and fixtures, package metadata, e2e mock content) to English; Chinese remains only in i18n catalogs, zh documents, and CJK-purpose test fixtures.
- [Serialize the dev prebuild to fix concurrent dev:server / dev:web clobbering](0.0.2/2026-07-20-serialize-dev-prebuild.md) — dev:server and dev:web now share a lock-serialized, deduplicated prebuild of skills and core, so launching both at the same time no longer corrupts dist/.
- [Add a combined pnpm dev and a dev:landing shortcut](0.0.2/2026-07-20-combined-dev-and-landing-shortcut.md) — pnpm dev starts the backend and web app together with prefixed logs (deps built once via the prebuild lock), and pnpm dev:landing serves the landing page dev server (port 7366) from the repo root.
- [Restructure the README around the product story](0.0.2/2026-07-20-readme-product-story.md) — The README now leads with the agents-build-agents pitch and community links, then three feature showcases (benchmark chart, one-sentence RAG demo, self-evolution), supported models, human-first installation, a roadmap, CONTRIBUTING.md, and a citation.
- [Upgrade AgentHub to 0.4.0 and adopt the opaque fidelity payload](0.0.2/2026-07-20-agenthub-0-4-fidelity.md) — Content items replace the item-level signature/phase fields with one opaque fidelity object carried verbatim through OmniMessage, Trace, and replay, and the agenthub-dev skill joins the built-in library.
- [Add the Qwen Token Plan provider group to the model catalog](0.0.2/2026-07-20-qwen-token-plan-provider.md) — A subscription-gateway group (OpenAI-compatible, preset base URL) with qwen3.8-max-preview, qwen3.7-max, qwen3.7-plus, glm-5.2, and deepseek-v4-pro, plus a custom provider logo.
