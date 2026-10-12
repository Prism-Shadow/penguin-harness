# @prismshadow/penguin-landing

The PenguinHarness product landing page (React + Vite + Tailwind CSS 4): bilingual (zh/en), light/dark themes, the Web App itself live in frames (the component gallery's demo app), benchmark charts, and a local-Markdown blog (product news / release notes).

It deploys to GitHub Pages together with the [docs site](../docs) and the [component gallery](../ui-gallery) as one artifact: landing at the site root, docs under `/docs/`, the gallery under `/gallery/` (assembled by `scripts/build-site.mjs` at the repo root; the nav, footer and CTA link into `/docs/`, the nav and footer into `/gallery/`).

## Development

```bash
pnpm --filter @prismshadow/penguin-landing dev        # http://127.0.0.1:7366
pnpm --filter @prismshadow/penguin-landing build      # dist/ (with 404.html SPA fallback + .nojekyll)
pnpm --filter @prismshadow/penguin-landing typecheck
pnpm --filter @prismshadow/penguin-landing test

BASE_PATH=/ pnpm build:site                           # repo root: assemble landing + docs + gallery
pnpm --filter @prismshadow/penguin-landing preview    # serve the assembled tree
```

`BASE_PATH` controls the asset base (GitHub Pages project pages need `/<repo>/`; local default `/`). The `Docs` link resolves only in the assembled build — in plain `dev` it points at a path this dev server doesn't serve.

### Live frames

The home page shows the real Web App in frames: the component gallery's frame document (`/gallery/app.html`, the app against an in-browser demo API), opened on one of the gallery's surfaces in the site's language and mode (`src/lib/live-frame.ts`, which imports the URL builder, window sizes and routes from `packages/ui-gallery`). The assembled site serves the gallery under `/gallery/`; in `dev`, the landing server passes `/gallery/` through to the gallery's own dev server, which has to run under that base:

```bash
BASE_PATH=/gallery/ pnpm dev:gallery                  # repo root: the gallery on :7372, under /gallery/
pnpm --filter @prismshadow/penguin-landing dev        # frames and the Gallery link now resolve
```

Without the gallery running, a frame keeps its placeholder. A frame is lazy (it loads about a screen ahead of the reader) and a guest (`embed=1`): it takes no focus and passes the wheel to the page until it is clicked. On phones it shows the gallery's phone window, and without a fine pointer it is a picture only; its window bar links to the same surface in the gallery.

## Deployment

`.github/workflows/pages.yml` builds landing + docs + gallery and deploys on pushes to main that touch any of the three packages, or the Web App and UI package the gallery frames (or on manual dispatch). First-time setup: repository Settings → Pages → Source = "GitHub Actions".

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

`pnpm --filter @prismshadow/penguin-landing shots` regenerates `src/assets/shots/`, the Cases section's video posters: the script ships a scripted mock LLM (speaking both Anthropic SSE and OpenAI chat-completions streams), boots the Web service on a temp data root, drives the real "build a RAG app" conversation (tools actually execute in the Workspace), then captures the finished chat page per UI language (zh/en, separate users) and mode (light/dark) in the app's default theme — `chat-<lang>-<mode>.webp`, re-encoded to WebP in Chromium to keep sizes down. Everything else on the home page is the app live, from the gallery. Prereqs: build core/server/web first, and have Playwright Chromium installed; `SHOTS_PORT` and `SHOTS_OUT_DIR` move the server and the output on a shared machine.

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
