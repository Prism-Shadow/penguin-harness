# Contributing to PenguinHarness

Thanks for helping build PenguinHarness! This guide covers the workspace setup, daily
commands, quality gates, and the repo's working rules.

## Prerequisites

- Node >= 24
- pnpm 10 (`corepack enable` or `npm install -g pnpm`)

## Setup and daily commands

```bash
pnpm install
pnpm build       # build first: core's exports point at dist/

pnpm dev         # backend + web app together (prefixed logs, deps built once)
pnpm dev:server  # backend at 127.0.0.1:7364
pnpm dev:web     # web app (Vite) at 127.0.0.1:7365, /api proxied
pnpm dev:docs    # docs site (Vite) at 127.0.0.1:7367
pnpm dev:landing # landing page (Vite) at 127.0.0.1:7366

BASE_PATH=/ pnpm build:site   # assemble landing + docs exactly like the Pages deploy
```

Every dev command runs `scripts/dev-prebuild.mjs` first, which (behind a lock that
serializes concurrent invocations) **keeps `pnpm install` current automatically** — a
fresh clone or a pulled lockfile change installs before starting, and an up-to-date tree
pays nothing (the lockfile hash is stamped) — then prebuilds the workspace deps (skills,
core) with back-to-back builds deduped: starting `dev:server` and `dev:web` at the same
time (or just `pnpm dev`) installs and builds exactly once. `dev:docs` / `dev:landing`
run the install check only (`--install-only`).

Copy `.env.example` to `.env` for model credentials in development.

## Repo layout

A pnpm monorepo (TypeScript, Node >= 24). One install ships four layers that share a
single data directory (`~/.penguin/data`) and a single message protocol (OmniMessage):

| Package                              | Name                          | Role                                                                                                    |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)     | `@prismshadow/penguin-core`   | SDK & engine: ReAct loop, OmniMessage protocol, LLM/Environment interface contracts, Agent State, Trace |
| [`packages/cli`](packages/cli)       | `@prismshadow/penguin-cli`    | The `penguin` command: REPL, one-shot runs, model & vault config, service launcher                      |
| [`packages/server`](packages/server) | `@prismshadow/penguin-server` | Web backend: HTTP API + SSE streaming, multi-user auth, Project authorization, usage stats              |
| [`packages/web`](packages/web)       | `@prismshadow/penguin-web`    | Web App: multi-session chat, Agent/skill/model management, Trace observability, evaluation center       |
| [`packages/skills`](packages/skills) | `@prismshadow/penguin-skills` | Built-in skill library (agent creation, benchmarking, evaluation, optimization, …)                      |
| [`packages/landing`](packages/landing) | —                           | Product landing page (this repo's website)                                                              |
| [`packages/docs`](packages/docs)     | —                             | Documentation site (bilingual, deployed under `/docs/`)                                                 |

Responsibilities split by source of truth: the **SDK** owns protocol and execution
(message parsing, the agent loop, tools), the **Server** owns the multi-user runtime
(auth, SSE streaming, scheduled tasks), and the **file layer** under `~/.penguin/data`
owns everything editable and recorded (prompts, Skills, secrets, Traces). The full map
is in [Architecture → Division of responsibilities](https://penguin.ooo/docs/architecture).

## Quality gates

CI runs all of these on every PR — run them locally before pushing:

```bash
pnpm format:check   # prettier
pnpm typecheck
pnpm test           # unit suites for every package
```

End-to-end suites (optional locally, slower):

```bash
npx playwright install chromium                      # once
pnpm --filter @prismshadow/penguin-web test:e2e      # browser e2e against a mock LLM
pnpm test:e2e                                        # core live-model e2e, needs DEEPSEEK_API_KEY
```

## Working rules

- **English is the repository's working language** — code, comments, error/log messages,
  test names and fixtures, package metadata, and developer docs. Chinese appears only
  where it is the content itself: zh i18n catalogs and fields (`strings.ts` dictionaries,
  CLI `i18n.ts`, `titleZh`, `short_description_zh`), `*.zh.md` documents, and test
  literals that assert zh i18n output or exercise CJK-specific behavior.
- **Every change ships with a changelog entry**: add
  `changelog/<version>/YYYY-MM-DD-<semantic-id>.md` under the next unreleased version
  (released versions' folders are frozen) — an H1 title, a one-sentence summary
  paragraph, then details — and add a one-line link for it to that version's index,
  `changelog/<version>/README.md`. The layout is documented in
  [`changelog/README.md`](changelog/README.md). Related changes may share one entry
  file (extending its details) instead of opening a new file per small change.
- **A release ships its own announcement**: `changelog/<version>/RELEASE.md` is published
  verbatim as the GitHub Release body. Write it during release preparation and **commit it
  before creating the tag** — the release workflow reads it from the tag's checkout, so a
  file added later never reaches the Release page. Without it the workflow falls back to
  GitHub's auto-generated notes.
- README assets under `assets/readme/` are generated — the benchmark charts from the
  landing benchmark data, and the demo screenshots via
  `node packages/landing/scripts/capture-readme-demo.mjs` (build first; needs Playwright
  chromium). Regenerate rather than hand-editing.

## Pull requests

- Branch from `main`; keep PRs focused on one topic.
- Make sure CI is green (build, format, typecheck, tests) and describe user-visible
  changes in the PR body.
- New user-facing behavior should come with tests, and with docs updates when it changes
  documented behavior (README, docs site).
