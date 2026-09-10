# The changelog contract

Loaded on demand from `SKILL.md`, which states the rule: every change ships a bilingual entry in
`changelog/unreleased/`, inside the PR that makes the change. This file is the shape of that
entry and the traps around it. `changelog/README.md` is the full spec — read it rather than
pattern-matching a neighbouring entry.

## The pair

- `YYYY-MM-DD-<slug>.md` and `YYYY-MM-DD-<slug>.zh.md`, mirroring section for section. One
  without the other is unfinished.
- H1, then the metadata block in fixed order — `Date` / `Type` / `Scope` / `PR` / `Issue` /
  `Breaking` — then the counterpart link, then a lead paragraph and bespoke sections. Field names
  and values stay English in both files so one `grep` covers the tree.
- Omit an inapplicable field entirely. Placeholders are what stop `grep -rl 'Breaking:'
  changelog/` from being an exact query.
- `Breaking` present ⇒ a `## Compatibility` / `## 兼容性` section stating what breaks and the
  migration step.
- Section headings are translated, not carried across: `## Details` → `## 细节`, `## Compatibility`
  → `## 兼容性`, bespoke ones naturally, in the same order and count. An English heading in the
  `.zh.md` is the most common way the pair stops mirroring.

## Rules that are easy to break

**There is no index file.** Do not add one, and do not port the index step from agenthub's own
workflow: the index was a single file every PR had to touch, which is precisely why it was deleted.

**Reasoning does not go on disk.** No `## Why`, `## Problem`, `## Decision`, `## Alternatives
considered`, `## Verification`, `## Risks`, and no claims about what the codebase currently *is*.
The thinking is still required — report it in the conversation and write it into the PR
description, which stays attached to its diff.

**Numbers are links, and half of them are issues.** A bare `#N` does not render as a link in
Markdown. Worse, this repository's bug reports and its PRs share one numbering space: `#83`, `#85`,
`#102`, `#136`–`#140`, `#150`, `#170`, `#215`, `#218`, `#229`, `#239` are issues. Classify before
writing — `gh api repos/Prism-Shadow/penguin-harness/issues/N --jq 'if .pull_request then "PR" else
"ISSUE" end'` — and route them to `Issue`, not `PR`. A cross-repo reference names its repo:
`agenthub [#162](https://github.com/Prism-Shadow/agenthub/pull/162)`.

The PR number exists only once the PR is open: open it, then add the links in a follow-up commit on
the same branch. `PR` is the field that actually gets forgotten — `grep -L 'PR:'
changelog/unreleased/*.md` before asking for review.

## Release mechanics

An entry ships **inside the PR that makes the change** — there is no separate aggregate PR.
Released version folders are frozen. `RELEASE.md` is written at release preparation and must be
committed **before** the tag: the workflow reads it from the tag's own checkout, so a file added
afterwards never reaches the Release page.
