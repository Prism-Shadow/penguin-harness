# Changelog Details

[中文版](README.zh.md)

Release history lives in two levels:

1. [`../CHANGELOG.md`](../CHANGELOG.md) — one line per release, linking its folder.
2. `<version>/YYYY-MM-DD-<slug>.md` — one detail file per change, recording what the change did.

There is deliberately **no per-release index file**. An index is a single file every PR has to touch, which turns an ordinary batch into a merge conflict; a folder listing plus `grep` answers the same questions without one. See [Finding things](#finding-things).

Everything that has not shipped goes into `unreleased/`, which is named for its state rather than a number because the version is not decided until release. Never create a numbered folder for unshipped work and never invent the next version number. At release preparation, `unreleased/` is renamed to the version actually shipped, `RELEASE.md` is written, the release line is added to the root file, and the next change recreates `unreleased/`.

`<version>/RELEASE.md` is the announcement published verbatim as the GitHub Release body: a lead sentence, then `## Install`, `## Highlights`, `## Notable in this release`, `## Requirements`, and a closing link to the folder. Only a numbered folder has one; it is written at release, when the version is finally known, and it must be **committed before the tag is created** — the release workflow reads it from the tag's own checkout, so a file added afterwards is never published. When it is missing, the workflow falls back to notes GitHub generates from the merged PRs. It is English-only: it is a publishing artifact, not a changelog record.

Released folders are frozen.

## Detail file format

Copy this template:

```markdown
# <Title: name the change, not the PR>

- **Date:** YYYY-MM-DD
- **Type:** feature
- **Scope:** `module`, `module`
- **PR:** [#N](https://github.com/Prism-Shadow/penguin-harness/pull/N)
- **Issue:** [#N](https://github.com/Prism-Shadow/penguin-harness/issues/N)
- **Breaking:** yes — <what breaks, in one line>

[中文版](<name>.zh.md)

<lead paragraph: what the change did>

## <bespoke section>

- ...
```

The metadata block sits directly under the H1, one field per bullet, always in the order above, so a reader and a `grep` find each field in the same place.

| Field | Required | Value |
| --- | --- | --- |
| `Date` | always | The entry date, matching the filename prefix. |
| `Type` | always | Exactly one of `feature` (new user-facing capability), `fix` (defect correction), `refactor` (restructuring with no capability change), `process` (tooling, docs, skills, CI, release plumbing). |
| `Scope` | always | 1–5 code areas, backticked, named as the tree names them (`core`, `server`, `web`, `cli`, `desktop`, `landing`, `docs`, `skills`, `tooling`, `ci`, `model-catalog`, `trace-index`, …). |
| `PR` | when one exists | Full link to the PR(s) that shipped this change. A bare `#N` does not render as a link in a Markdown file, so always write the URL — in the body too. A PR mentioned in the prose for context is a cross-reference, not a shipping PR, and stays inline. |
| `Issue` | when one exists | Full link to the issue(s) the change closes or answers. **Check which one a number is before writing it** — this repository's bug reports and its PRs share one numbering space, and a report filed as an issue belongs here, not under `PR`. Multiple links are comma-separated. |
| `Breaking` | only when breaking | `yes — <one line>`. Omit the field entirely otherwise, so `grep -rl 'Breaking:' changelog/` lists exactly the breaking changes. |

Omit a field that does not apply rather than writing a placeholder. A change with no PR or issue (pre-convention entries, or work landed outside a PR) simply has no such line.

A cross-repository reference is written as a full link too, and named: `agenthub [#162](https://github.com/Prism-Shadow/agenthub/pull/162)`. A bare `#162` in the prose reads as this repository's #162, which is a different change entirely.

### Body

An entry records **what was done**, in past tense. It opens with a lead paragraph and continues in bespoke sections named for their content — reuse an existing name (`## Details`, `## Compatibility`) before inventing one. An entry whose `Breaking` field is set carries a `## Compatibility` section stating what breaks and the migration step: the instruction, not an argument for why the rest is safe.

**Reasoning does not go on disk.** No `## Why`, `## Problem`, `## Decision`, `## Alternatives considered`, `## Verification`, `## Risks`. The thinking still has to happen — it is reported in the conversation and written into the PR description, which stays attached to the diff it describes. An agent that wants it pulls the PR description, `git blame`, or `git log`; those carry their own timestamp, so nothing has to be re-checked for staleness first.

**Do not describe the current state of the codebase.** "`X` is not exported from `Y`", "the client folder now holds `Z`" — these read as fact, drift silently as the code moves, and cost every later reader a verification they did not ask for. Write what the change did at the time, not what the repository is today.

Cross-reference other entries with relative links, e.g. `[backward compatibility](2026-07-24-backward-compatibility.md)` — from a Chinese file, link the Chinese counterpart so a reader stays in one language. Relative links survive the folder rename at release time and can be checked mechanically.

## Chinese counterpart

Every entry ships in both languages: `<name>.md` in English and `<name>.zh.md` in Chinese, mirroring it section for section. A change is not complete until both exist — write the English file first, then the counterpart, in the same PR.

What stays in English, verbatim, so one `grep` works across both languages:

- The metadata field names and their values — `- **Type:** feature`, the `Scope` identifiers, the `Date`, and the links. Only the `Breaking` reason is prose, so only it is translated.
- Code identifiers, model ids, parameter names, error classes, and file paths.

What gets translated: all prose, and the section headings. Use these renderings for the standard headings:

| English | 中文 |
| --- | --- |
| `## Details` | `## 细节` |
| `## Compatibility` | `## 兼容性` |

Bespoke headings are translated naturally, keeping the same order and count as the English file. Each file links its counterpart on the line directly below the metadata block: `[中文版](<name>.zh.md)` in the English file, `[English](<name>.md)` in the Chinese one.

## Finding things

| Question | Query |
| --- | --- |
| What shipped in a release? | `ls changelog/<version>/` |
| What has ever broken compatibility? | `grep -rl 'Breaking:' changelog/` |
| Every entry touching the model catalog | `grep -rl 'Scope:.*model-catalog' changelog/` |
| Only bug fixes | `grep -rl 'Type:\*\* fix' changelog/` |
| Which PR shipped an entry | `grep 'PR:' changelog/<version>/<entry>.md` |
| Which entries a PR appears in | `grep -rl 'pull/263' changelog/` |
| Entries answering a reported issue | `grep -rl 'Issue:' changelog/` |

Written in English first, mirrored in Chinese. History starts after the v0.0.1 release (2026-07-19); earlier changes are not backfilled.
