---
name: penguin-harness-dev
description: Use when developing PenguinHarness itself — changing packages/{core,server,web,cli,desktop,landing,docs,skills}, the built-in model catalog, the installers or the release workflow; writing or auditing changelog entries; writing a blog post or capturing release screenshots; deciding what to do about data already on disk; or auditing prose that reads like a leaked authoring session. Covers the two-repo symlink layout, the CI-parity verification chain, the record-and-ship contract, where blog media is hosted, and the seams that are intentional.
---

# Developing PenguinHarness

PenguinHarness is a TypeScript monorepo: an Agent SDK (`packages/core`), an HTTP server (`packages/server`), a Web App (`packages/web`), a CLI (`packages/cli`), an Electron shell (`packages/desktop`), the landing and docs sites, and the shipped plugin library — one npm package per plugin under the repo root's `plugins/`, with `packages/plugins` as the loader that depends on them all. It **consumes** LLM providers through `@prismshadow/agenthub` and implements no provider clients of its own.

## Repo shape — read before your first edit

Two repositories sit side by side: the implementation repo (`penguin-harness`) and the design repo (`penguin-harness-design`). Three paths inside the implementation repo are symlinks into the design repo and are gitignored here:

- `design/` → the design repo, so specs are reachable as `design/specs/…`
- `AGENTS.md` → `design/AGENTS.md`
- `CLAUDE.md` → `AGENTS.md`

Editing `AGENTS.md`, `CLAUDE.md` or anything under `specs/` edits **the design repo's files**. Commit them there, on their own branch, in their own PR. They can never appear in an implementation-repo PR. A fresh clone has none of the three links; recreate them by hand.

Both repos take changes through branch + PR against `main`, squash-merged. Do not push to `main`.

Branches are `feat/<topic>`, `fix/<topic>`, `docs/<topic>` in both repos. Some older branches here read `docs-<topic>` instead: a remote branch literally named `docs` once held that ref namespace and made the slashed form unpushable. It is gone — if a push is ever rejected as a directory/file conflict again, `git ls-remote --heads origin` names the branch responsible.

Independent changes each get their own git worktree under `../penguin-harness-wt/<topic>/` so several can run in parallel.

## Verify what you changed

Node must be >= 24. In each worktree, `pnpm install --frozen-lockfile` first.

The full chain CI runs is `pnpm build`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `sh scripts/test-installer.sh`. **Do not reach for `pnpm test` by reflex** — it is nine packages and ~2500 tests, minutes per run, and for a docs-only diff it proves nothing the narrow run does not. Pick the narrowest evidence that would actually fail for this change's regression:

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

Always cheap, always worth it: `git diff --check`, and `pnpm format` + `format:check` on any diff at all.

Run the whole chain in exactly three cases: the change spans the repo widely enough that nothing narrower is credible, you are diagnosing a CI failure, or you are asked to. There are no coverage thresholds in this repo, so nothing forces a wider run than the behavior needs.

`ci-windows` runs the same minus `format:check`, plus `scripts/test-installer.ps1`. Two failures there are known and are not your diff: a bare `Failed` worker crash, and an `environment.test.ts` truncation-timing assertion — rerun before debugging. An `EBUSY` on removing a directory that is some child process's cwd is real, not a flake.

**A fake that is kinder than the real thing hides the bug it was written for.** Transports are faked at a seam here — `createSocket`, `createClient`, a stubbed `globalThis.fetch` — and the half that drifts is the failure contract, not the happy path. A fake that hands back a fresh cursor where the adapter returns the one it was given, or that resolves where production parks, passes a test whose subject is exactly that path. Write the fake's failure branches from the adapter's, not from what the assertions need.

**A structural assertion that was already true at the base commit is not a test.** Reading source text in a test is house style here (20 web test files do it), which makes it easy to assert a shape the file already had. Replay each new assertion against `git show <base>:<path>` and keep the ones that fail there.

The local server suite drops a few tests under full parallel load — they time out and pass on their own. Rerun the file alone before blaming the diff.

Once the evidence you chose passes, commit and push to the current branch without asking. Force-pushes and reverting someone else's commits still need confirmation.

**On a conflicting PR, waiting for CI is waiting for nothing.** The workflows run against the merge commit GitHub builds from the branch and `main`, and it does not build one while the two conflict — the checks never start, so polling `statusCheckRollup` returns the same pending or empty list forever. Read the state before the checks: `gh pr view <n> --json mergeable,mergeStateStatus` answers `CONFLICTING` / `DIRTY`. Merge `origin/main` into the branch, resolve, push, and only then expect checks. Two more things that pass silently and are worth checking in the same pass: an auto-merged file is not a correct file, so read the merged result where two PRs touched one region; and a test constant pinned to a count the other PR changed fails for a reason that has nothing to do with either change — derive the count instead of re-pinning it.

## Record and ship

Every change ships a changelog entry, in both languages, in `changelog/unreleased/`:

- `YYYY-MM-DD-<slug>.md` and `YYYY-MM-DD-<slug>.zh.md`, mirroring section for section. One without the other is unfinished.
- H1, then the metadata block in fixed order — `Date` / `Type` / `Scope` / `PR` / `Issue` / `Breaking` — then the counterpart link, then a lead paragraph and bespoke sections. Field names and values stay English in both files so one `grep` covers the tree.
- Omit an inapplicable field entirely. Placeholders are what stop `grep -rl 'Breaking:' changelog/` from being an exact query.
- `Breaking` present ⇒ a `## Compatibility` / `## 兼容性` section stating what breaks and the migration step.
- Section headings are translated, not carried across: `## Details` → `## 细节`, `## Compatibility` → `## 兼容性`, bespoke ones naturally, in the same order and count. An English heading in the `.zh.md` is the most common way the pair stops mirroring.

`changelog/README.md` is the full spec. Read it rather than pattern-matching a neighbouring entry.

**There is no index file.** Do not add one, and do not port the index step from agenthub's own workflow: the index was a single file every PR had to touch, which is precisely why it was deleted.

**Reasoning does not go on disk.** No `## Why`, `## Problem`, `## Decision`, `## Alternatives considered`, `## Verification`, `## Risks`, and no claims about what the codebase currently *is*. The thinking is still required — report it in the conversation and write it into the PR description, which stays attached to its diff.

**Numbers are links, and half of them are issues.** A bare `#N` does not render as a link in Markdown. Worse, this repository's bug reports and its PRs share one numbering space: `#83`, `#85`, `#102`, `#136`–`#140`, `#150`, `#170`, `#215`, `#218`, `#229`, `#239` are issues. Classify before writing — `gh api repos/Prism-Shadow/penguin-harness/issues/N --jq 'if .pull_request then "PR" else "ISSUE" end'` — and route them to `Issue`, not `PR`. A cross-repo reference names its repo: `agenthub [#162](https://github.com/Prism-Shadow/agenthub/pull/162)`.

The PR number exists only once the PR is open: open it, then add the links in a follow-up commit on the same branch. `PR` is the field that actually gets forgotten — `grep -L 'PR:' changelog/unreleased/*.md` before asking for review.

An entry ships **inside the PR that makes the change** — there is no separate aggregate PR. Released version folders are frozen. `RELEASE.md` is written at release preparation and must be committed **before** the tag — the workflow reads it from the tag's own checkout.

## Blog posts, and where their images live

A post is a pair under `packages/landing/content/blog/`: `<slug>.en.md` and `<slug>.zh.md`, each with `title` / `date` / `category` / `excerpt` frontmatter. Same rule as changelog entries — one without the other is unfinished.

**The images are not in this repo.** Screenshots and demo videos live in the sibling `Prism-Shadow/penguin-harness-community` repo, under `blog-assets/` and `videos/`. A published post's screenshots are never deleted, so that asset class grows without bound in the number of posts written; keeping it out of this history keeps everyone's clone small.

**Posts still write a repo-local path.** Reference an image as `/blog-assets/<name>` — both `![alt](…)` and the raw `<img src="…">` some posts use — and let the renderer resolve it: `blogAssetUrl` in `packages/landing/src/lib/links.ts`, applied by the `img` adapter in `src/pages/blog-post.tsx`. Never paste the raw `raw.githubusercontent` URL into a post. One source of truth for the host, Markdown that stays readable and diffable, and moving the host again is a one-line change instead of a sweep over every post.

Release screenshots are captured, not mocked up: drive the app through the Playwright e2e harness in `packages/web/e2e/` with its mock LLM, against a scratch `PENGUIN_HOME` — never `~/.penguin`, which is the developer's real data. Shoot at `deviceScaleFactor: 2`, crop to the feature rather than the whole window, and check the frame for what must not ship publicly: absolute paths carrying a home directory, API keys, and mock-model filler text.

## Changing the built-in model catalog

`packages/core/src/state/model-catalog.ts` is the single source of truth for presets, shared by core's defaults, the server's initial config, and web/CLI display. It is a *catalog*, not a routing table — AgentHub owns routing.

- Pricing is three buckets in USD per million tokens: `cache_read` (the vendor's cache-hit price), `cache_write` (the vendor's cache-write price, or the standard input price where the vendor charges no write premium), `output`. `cny(...)` converts official CNY list prices at the 7:1 display convention.
- A vendor with **tiered** pricing gets its base tier recorded, and the tier boundary noted in the section comment — OpenAI above 272K input, Gemini 3.1 Pro above 200K, MiniMax M3 above 512K. Long-context use is then knowingly under-costed; that is the convention, not an oversight.
- A **promotion** is a `discount` fraction beside the list `pricing`, never a discounted number written into `pricing`: `effectivePricing()` derives the billed rate, and a lapsed promotion is one field to delete with the rate to return to still on the row. `presetModelEntries()` writes the effective rate, so what a Project stores is what the gateway charges.
- A **time-based** tier is an `offPeakDiscount` schedule instead, and it is never baked into a Project. The row stores its peak price, and the cost center decides the tier from each usage record's own `ts` — the aggregation splits by tier before pricing. Deciding it at read time instead would move a finished week's cost every time the boundary passed.
- Uniqueness is the `(provider, model_id)` pair, never the bare id — gateways resell vendor models under their upstream ids.
- Set `client_type` only when the id cannot be auto-routed or a protocol must be pinned, and inline `baseUrl` with it. Everything else is auto-routed by AgentHub.
- A provider group is split only when the vendor genuinely has separate endpoints or billing paths (Qwen Token Plan vs Pay-As-You-Go). One endpoint serving several key types is one group.
- `resolveModelEnv` mirrors AgentHub's exact routing; a lookalike id must stay unroutable.
- Adding a model touches the catalog test's exact-order assertions, `packages/web/src/features/models/protocol-path.ts` when the client's request path is not `/chat/completions`, the provider glyph map, and the bilingual `models` / `configuration` docs.
- **Moving the default reaches further than adding a model.** `defaultProjectConfig()` in `packages/core/src/state/project-config.ts` holds it, and six documented first-run commands pin it by hand — `README.md`, `README.zh.md`, and `quickstart-cli` / `quickstart-sdk` in both languages — each ending `--set-default`, which writes `default_model`. Leave them on the old id and the documented first run silently undoes the change on every fresh install. The `models` and `configuration` samples carry it in two places that must move together, the `default_model` line and the `[[models]]` row it names (a default naming no entry is rejected on load), and `plugins/agent-development/skills/penguin-sdk/SKILL.md` states it in prose.

Existing Projects never migrate automatically: presets are copied into `.project_config.toml` at creation and nothing rewrites them. Users pick changes up through the models page's explicit "sync presets", which appends and updates catalog-owned fields but never deletes and never touches the stored default. Say so in the entry.

## Backward compatibility is the user's call, not yours

When a change touches data or configuration already on disk — Traces, `system_config.yaml`, `.project_config.toml`, installed skills, `web.db`, localStorage keys — do not pick a strategy. State plainly what breaks if nothing is done, offer the options (permanent dual-format tolerance / one-time migration / a documented reset path / accept the break and say so), and let the user decide.

Whatever is decided, compatibility code is a standing cost: name **how long it stays, who removes it, and what has to be true first**, at the code site and in a dedicated `changelog/unreleased/YYYY-MM-DD-backward-compatibility.md`. Other entries in that batch reference that file instead of re-telling it. A batch with no compatibility handling has no such file.

## Prose that survives the session

Comments, JSDoc, docs and changelog entries are read by people who have no access to the session that produced them. Apply one test to any suspect passage:

> Could a reader at HEAD, with no session transcript and no uncommitted draft, resolve every reference and verify every claim?

If not, keep the surviving facts and delete the rest. What to hunt:

- **Dead citations** — design-session decision numbers, `§N` of an uncommitted draft, audit item codes. This repo already swept design-doc citations out of code comments once; do not reintroduce them.
- **Stack and review vantage** — "a later PR in this stack", "rejected in review", "the reviewer confirmed". State the shipped mechanism; drop the choreography.
- **Change narration** — "used to", "no longer", "this cut". A comment describes what the code does now. A changelog entry describes what the change did, in past tense — that is the one place narration is correct.
- **Reviewer-addressed justification** — defensive paragraphs arguing a choice was fine. State the invariant, or delete.
- **Hedged planning residue** — "probably fine for now". Promote to a real `TODO` with a name, or replace with the actual bound.
- **Authoring-language slips** — untranslated fragments. Non-i18n code and developer docs are English-only; Chinese belongs in i18n catalogs, `*.zh.md` documents, and tests asserting CJK behavior.

Keep, deliberately: issue and merged-PR links, suppression justifications, counterfactual-present statements ("without this, X happens"), measured bounds and the numbers behind them, and lifecycle descriptions of runtime behavior.

## Proposing simplifications

A simplification needs evidence, not taste. Strong cases: a public method, event, config knob, helper or package with **no production consumer** (`packages/*/src`, `examples`, `scripts` — tests and docs do not count); two representations mirroring one fact; hand-rolled code a maintained dependency or Node builtin already covers; defensive machinery guarding an unused API.

Do not propose it when a production caller exists (that is a feature decision), when the removal forces unrelated churn without shrinking any public surface, or when the defensive pattern protects a load-bearing invariant. Correct but tiny belongs in a named `TODO(<smell>)`, not a proposal.

Seams that are intentional here — collapsing one is a product decision, not cleanup:

- the AgentHub boundary: PenguinHarness pins protocols and env fallback, AgentHub owns clients and routing;
- `packages/core/src/internal/` versus what the package barrel exports — the public SDK surface is a contract;
- the Trace on-disk format and its tolerant readers;
- the bilingual documentation pairs and the i18n catalogs;
- `desktop` running the *unchanged* server and Web App.

Prove consumers with `rg` over exact symbols, event names and wire strings, and read the call sites. There is no `knip` here, and no Agent Note tree — a proposal lives in the PR description or an issue.

## What this repo is not

Imported wholesale from a sibling repo's workflow, these are wrong here:

- **Provider-client development.** No vendor doc syncing, no live API captures, no paired Python/TypeScript clients, no `AVAILABLE_MODELS`. That is agenthub's work; PenguinHarness only records presets in its catalog.
- **Changelog index files.** Deleted on purpose. See above.
- **`gh pr create --base dev`.** The base branch is `main`.
- **Agent Notes** (`.agents/notes/<lifecycle>/<class>/…`) and their supersession lifecycle. No such convention.
- **`knip`, `pnpm run doc-sync`, `pnpm run lint`.** None exist; the real chain is the one above.
- **Coverage-scoped verification** (`--coverage.include`, per-file thresholds). No coverage gate is configured here, so narrowing means choosing test files, not proving coverage over a source scope.
- **Adding a skill to the repo root's `plugins/`** because it is "a skill". Those packages are the shipped, user-facing plugin library — a docs-sync test requires every plugin to appear in the bilingual skills pages, the README tables are test-checked, and everything there installs into users' agents. Repo development skills live in `.agents/skills/`.
