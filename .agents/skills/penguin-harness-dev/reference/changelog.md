# The changelog contract

Loaded on demand from `SKILL.md`, which states the rule: every change ships an English entry in
`changelog/unreleased/`, inside the PR that makes the change. This file is the shape of that
entry and the traps around it. `changelog/README.md` is the full spec — read it rather than
pattern-matching a neighbouring entry.

## The entry

- `YYYY-MM-DD-<slug>.md`, written in English.
- H1, then metadata in order: `Date`, `Type`, `Scope`, `PR`, `Issue`, `Breaking`.
- Omit inapplicable fields. Follow with a lead paragraph and relevant sections.
- A breaking change needs a `## Compatibility` section with migration instructions.

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
