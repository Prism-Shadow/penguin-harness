# @prismshadow/penguin-landing

The PenguinHarness product landing page (React + Vite + Tailwind CSS 4): bilingual (zh/en), light/dark themes, the feature matrix and CONTRACT.md showcase, benchmark charts, Playwright-captured product screenshots, and a local-Markdown blog (product news / release notes).

It deploys to GitHub Pages together with the [docs site](../docs) as one artifact: landing at the site root, docs under `/docs/` (assembled by `scripts/build-site.mjs` at the repo root; the nav, footer and CTA link into `/docs/`).

## Development

```bash
pnpm --filter @prismshadow/penguin-landing dev        # http://127.0.0.1:7366
pnpm --filter @prismshadow/penguin-landing build      # dist/ (with 404.html SPA fallback + .nojekyll)
pnpm --filter @prismshadow/penguin-landing typecheck
pnpm --filter @prismshadow/penguin-landing test

BASE_PATH=/ pnpm build:site                           # repo root: assemble landing + docs
pnpm --filter @prismshadow/penguin-landing preview    # serve the assembled tree
```

`BASE_PATH` controls the asset base (GitHub Pages project pages need `/<repo>/`; local default `/`). The `Docs` links resolve only in the assembled build — in plain `dev` they point at a path this dev server doesn't serve.

## Deployment

`.github/workflows/pages.yml` builds landing + docs and deploys on pushes to main that touch either package (or on manual dispatch). First-time setup: repository Settings → Pages → Source = "GitHub Actions".

## Blog

Posts live in `content/blog/<slug>.<lang>.md` (`lang` is `zh` / `en`; the two language versions of a slug fall back to each other). Frontmatter:

```markdown
---
title: Post title
date: 2026-07-17
category: news | changelog
excerpt: One-line summary for the list page
---
```

## Screenshots

`pnpm --filter @prismshadow/penguin-landing shots` regenerates `src/assets/shots/`: the script ships a scripted mock LLM (speaking both Anthropic SSE and OpenAI chat-completions streams), boots the Web service on a temp data root, drives a real "build an Agent app" conversation (tools actually execute in the Workspace), then captures the chat, trace and evaluation pages per UI language (zh/en, separate users) and theme (light/dark) — 12 shots (`<page>-<lang>-<theme>.webp`, re-encoded to WebP in Chromium to keep sizes down). The landing page always shows the shot matching the visitor's language and theme. Prereqs: build skills/core/server/web first, and have Playwright Chromium installed.

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
