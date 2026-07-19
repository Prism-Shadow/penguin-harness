# @prismshadow/penguin-docs

The PenguinHarness documentation site (React + Vite + Tailwind CSS 4). Its own package, sharing the landing page's visual language: bilingual pages (zh/en), light/dark themes, a sidebar + per-page table of contents, and a "Copy Markdown" button on every page.

Live at <https://prism-shadow.github.io/penguin-harness/docs/>.

## Content model

Pages are local Markdown files — `content/<slug>.<zh|en>.md`, one file per page per language (missing languages fall back to the other). Frontmatter:

```markdown
---
title: Page title
description: One-line summary rendered under the title
---
```

Navigation (sections, order, prev/next) is defined once in `src/lib/nav.ts`; a vitest check (`test/content.test.ts`) keeps nav and content in sync — every navigated slug must have both language files with a title, and no orphan files may exist. Internal links are written as absolute doc paths (`[Core Interfaces](/interfaces)`).

## Development

```bash
pnpm dev:docs                                      # http://127.0.0.1:7367 (repo root script)
pnpm --filter @prismshadow/penguin-docs build      # dist/ + per-route shells for deep links
pnpm --filter @prismshadow/penguin-docs typecheck
pnpm --filter @prismshadow/penguin-docs test
```

## Deployment

Deployed to GitHub Pages together with the landing page as one artifact: `scripts/build-site.mjs` (repo root) builds landing with `BASE_PATH=<base>` and docs with `BASE_PATH=<base>docs/`, then copies this package's `dist/` into the landing dist under `docs/`. `.github/workflows/pages.yml` runs it on pushes to main touching either package.

```bash
BASE_PATH=/ pnpm build:site                        # assemble locally
pnpm --filter @prismshadow/penguin-landing preview # serve the assembled site
```

Deep links work without a 404 fallback: the post-build step copies the SPA shell to `dist/<slug>/index.html` for every content slug.

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
