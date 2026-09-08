---
name: penguin-harness-dev
description: Use when developing PenguinHarness itself — changing packages/{core,server,web,cli,desktop,landing,docs,skills}, the built-in model catalog, the installers or the release workflow; writing or auditing changelog entries; writing a blog post or capturing release screenshots; running the test suite here or, when asked, on another machine; deciding what to do about data already on disk; or auditing prose that reads like a leaked authoring session. Covers the two-repo symlink layout, the CI-parity verification chain, the record-and-ship contract, where blog media is hosted, and the seams that are intentional.
---

# Developing PenguinHarness

PenguinHarness is a TypeScript monorepo: an Agent SDK (`packages/core`), an HTTP server
(`packages/server`), a Web App (`packages/web`), a CLI (`packages/cli`), an Electron shell
(`packages/desktop`), the landing and docs sites, and the shipped plugin library — one npm package
per plugin under the repo root's `plugins/`, with `packages/plugins` as the loader that depends on
them all. It **consumes** LLM providers through `@prismshadow/agenthub` and implements no provider
clients of its own.

This page is the part that applies to every change. Four reference files carry the detail, read
them when the task reaches them:

| Read | When |
| --- | --- |
| `reference/verification.md` | A test fails oddly, CI reads green when it should not, or the user asks you to run the suite on another machine |
| `reference/changelog.md` | Writing or auditing a changelog entry |
| `reference/model-catalog.md` | Touching `model-catalog.ts`, pricing, provider groups or glyphs |
| `reference/authoring.md` | Writing a blog post, auditing prose, or proposing a simplification |

## Repo shape — read before your first edit

Two repositories sit side by side: the implementation repo (`penguin-harness`) and the design repo
(`penguin-harness-design`). Three paths inside the implementation repo are symlinks into the design
repo and are gitignored here:

- `design/` → the design repo, so specs are reachable as `design/specs/…`
- `AGENTS.md` → `design/AGENTS.md`
- `CLAUDE.md` → `AGENTS.md`

Editing `AGENTS.md`, `CLAUDE.md` or anything under `specs/` edits **the design repo's files**.
Commit them there, on their own branch, in their own PR. They can never appear in an
implementation-repo PR. A fresh clone has none of the three links; recreate them by hand.

Both repos take changes through branch + PR against `main`, squash-merged. Do not push to `main`,
and `gh pr create --base main` — not `dev`, whatever a sibling repo does.

Branches are `feat/<topic>`, `fix/<topic>`, `docs/<topic>` in both repos. Some older branches here
read `docs-<topic>` instead: a remote branch literally named `docs` once held that ref namespace and
made the slashed form unpushable. It is gone — if a push is ever rejected as a directory/file
conflict again, `git ls-remote --heads origin` names the branch responsible.

Independent changes each get their own git worktree under `../penguin-harness-wt/<topic>/` so
several can run in parallel.

## Verify what you changed

Node must be >= 24. In each worktree, `pnpm install --frozen-lockfile` first.

The full chain CI runs is `pnpm build`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`,
`sh scripts/test-installer.sh`. **Do not reach for `pnpm test` by reflex** — it is nine packages and
~2500 tests, minutes per run, and for a docs-only diff it proves nothing the narrow run does not.
Pick the narrowest evidence that would actually fail for this change's regression:

```sh
pnpm --filter @prismshadow/penguin-core exec vitest run test/model-catalog.test.ts   # one file, ~1s
pnpm --filter @prismshadow/penguin-web test                                          # one package
```

| Changed | Run |
| --- | --- |
| Markdown only — changelog, `.github/CONTRIBUTING.md`, `.agents/`, README | `pnpm format:check` |
| `packages/docs/content/**`, blog posts under `packages/landing/content/**` | `format:check` + the `docs` and `landing` package tests (search index, blog fixtures) |
| `plugins/**` (repo root) | the `plugins` package test (loader, README tables, the hook scripts against fake Traces) + `docs`'s `skills-sync.test.ts` |
| The model catalog | core `model-catalog.test.ts`, web `model-grouping.test.ts` and `protocol-path.test.ts`, server `models.test.ts` |
| One package's source | that package's `test`, plus `typecheck` |
| Exported core types, or anything downstream imports | `pnpm build` + `pnpm typecheck` before any test |
| `package.json`, the lockfile, `pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` + `pnpm build` |
| Installers, `release.yml` | `sh scripts/test-installer.sh` |

Always cheap, always worth it: `git diff --check`, and `pnpm format` + `format:check` on any diff at
all.

Run the whole chain in exactly three cases: the change spans the repo widely enough that nothing
narrower is credible, you are diagnosing a CI failure, or you are asked to. There are no coverage
thresholds in this repo, so nothing forces a wider run than the behavior needs.

**Tests run on this machine unless the user asks otherwise.** Moving a suite to another host is
something they request in so many words, not an optimisation to take on your own — see
`reference/verification.md` for how, and for why a difference between two machines is a finding
rather than something to paper over.

Once the evidence you chose passes, commit and push to the current branch without asking.
Force-pushes and reverting someone else's commits still need confirmation.

When a test fails in a way that does not match your diff, when CI reads green too easily, or when a
fake or an assertion looks like it proves nothing, read `reference/verification.md` before spending
a second round on it.

## Record and ship

Every change ships a changelog entry, in both languages, in `changelog/unreleased/`: a
`YYYY-MM-DD-<slug>.md` and `YYYY-MM-DD-<slug>.zh.md` pair mirroring section for section, inside the
PR that makes the change. One without the other is unfinished, **there is no index file**, and
reasoning belongs in the PR description rather than on disk.

`changelog/README.md` is the full spec and `reference/changelog.md` has the shape plus the traps
(the metadata block's fixed order, translated headings, `#N` numbers that are often issues rather
than PRs, and the `PR:` field everyone forgets). Read one of them before writing an entry rather
than pattern-matching a neighbouring one.

## Backward compatibility is the user's call, not yours

When a change touches data or configuration already on disk — Traces, `system_config.yaml`,
`.project_config.toml`, installed skills, `web.db`, localStorage keys — do not pick a strategy.
State plainly what breaks if nothing is done, offer the options (permanent dual-format tolerance /
one-time migration / a documented reset path / accept the break and say so), and let the user decide.

Whatever is decided, compatibility code is a standing cost: name **how long it stays, who removes
it, and what has to be true first**, at the code site and in a dedicated
`changelog/unreleased/YYYY-MM-DD-backward-compatibility.md`. Other entries in that batch reference
that file instead of re-telling it. A batch with no compatibility handling has no such file.
