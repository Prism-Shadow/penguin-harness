---
title: Check in the UI that every change in the ref's changelog is really there
starts_from: install/from-ref
inputs:
  ref: the same ref install/from-ref installed
  handover: <RUN>/install/from-ref/handover.md
cost: 60
platforms: [linux, macos, windows]
---

## Goal

Take the changelog of the version under test and check each entry against the running product,
through the UI wherever the change is visible there. The report tells, entry by entry, whether the
promised change is present.

## Steps

Read `handover.md` first and sign in to the server it names. Keep `oplog.md` from the first click:
one line per action, with the time, what was clicked or typed, and what the screen showed.

1. **Get the changelog as published.**
   - A tag with a GitHub Release: the release body,
     `gh release view <ref> --repo Prism-Shadow/penguin-harness --json body --jq .body`.
   - A revision, or a tag without a release: the entries under `changelog/unreleased/` at that
     revision (English files, not the `.zh.md` copies).
   - Save the text unmodified to `evidence/changelog.md`.
   - Counter-example: using a changelog from a different revision than the one installed.

2. **Split it into entries.** One row per bullet of `## Highlights` and `## Notable in this release`
   for a release, or one row per detail file for unreleased entries.

3. **Check each entry.** Find where the change shows in the product and try it.
   - Verdict per row: **verified** (with the screenshot that shows it), **not verified** (with the
     reason: it could not be reached, it behaved differently, or it needs something this
     environment lacks), or **not applicable** (for example, a Windows-only change on Linux).
   - A change that is not visible in the UI (an installer, a CLI command, a server behaviour) is
     checked through the surface it does have, and the row says which.
   - Screenshot: `c<nn>-<nn>-<what>.png`, numbered by row.
   - Counter-example: a verdict without a screenshot or a quoted line behind it.

4. **Problems.** Every row that is not verified because the product behaves differently from what
   the entry says goes into `issues.md`, quoting the entry.

## Record

In `<RUN>/ui/changelog/`: `report.html` with one table row per changelog entry (entry, verdict,
evidence, notes), `shots/`, `evidence/changelog.md`, `oplog.md`, `issues.md`.

## Done when

Every entry of the changelog has a row with a verdict, and every "not verified" row has its reason.

## Never

- Read the changelog from a checkout of a different revision than the one installed.
- Mark an entry verified because it "should" work, or because a test in the repository covers it.
- Change the environment beyond what checking an entry needs; note in `oplog.md` everything you
  changed.
