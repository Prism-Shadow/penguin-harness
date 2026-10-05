---
title: Check that every change in the ref's changelog is really there
starts_from: install/from-ref
inputs:
  ref: the same ref install/from-ref installed
  handover: <RUN>/install/from-ref/handover.md
  changelog_plan: <RUN>/changelog/verify/plan.md, produced as described under Prepare
cost: 60
platforms: [linux, macos, windows]
---

## Goal

Take the changelog of the version under test and check each entry against the running product,
through the UI wherever the change is visible there. The report tells, entry by entry, whether the
promised change is present.

## Prepare

Before the run, write the changelog plan to `<RUN>/changelog/verify/plan.md`, for review with the
rest of the run's plan.

1. **Get the changelog as published.**
   - A tag with a GitHub Release: the release body,
     `gh release view <ref> --repo Prism-Shadow/penguin-harness --json body --jq .body`.
   - A revision, or a tag without a release: the entries under `changelog/unreleased/` at that
     revision (English files, not the `.zh.md` copies).
   - Save the text unmodified next to the plan, as `changelog.md`.
2. **One row per entry**: one per bullet of `## Highlights` and `## Notable in this release` for a
   release, or one per detail file for unreleased entries. For each row:
   - the entry, quoted;
   - the surface it is checked through (a UI page, a CLI command, the installer, a server
     response), and the steps to reach it;
   - what must be seen if the change is there;
   - or "not applicable" with the reason, decided now (for example, a Windows-only change on a
     Linux run).

Counter-example: a plan built from a changelog of a different revision than the one installed, or
a row whose expected observation is "it works".

## Steps

Read `handover.md` first and sign in to the server it names. Keep `oplog.md` from the first click.

1. **Check each row of the plan, in order.** Follow its steps on its surface and compare with what
   the plan says must be seen.
   - Verdict per row: **verified** (with the screenshot or quoted line that shows it), or **not
     verified** with the reason: it could not be reached, it behaved differently, or it needs
     something this environment lacks. Rows the plan marks "not applicable" stay so.
   - Screenshot: `c<nn>-<nn>-<what>.png`, numbered by row.
   - Counter-example: a verdict without a screenshot or a quoted line behind it.
2. **When a row's steps turn out wrong** (the page moved, the command was renamed), find the
   change another way, record the corrected steps in the report, and give the verdict on what was
   found.
3. **Problems.** Every row not verified because the product behaves differently from what the
   entry says goes into `issues.md`, quoting the entry.

## Record

In `<RUN>/changelog/verify/`: `report.html` with one table row per changelog entry (entry,
surface, verdict, evidence, notes), `shots/`, `oplog.md`, `issues.md`, next to the `plan.md` and
`changelog.md` prepared before the run.

## Done when

Every row of the plan has a verdict, and every "not verified" row has its reason.

## Never

- Start without a reviewed plan, or add rows to it during the run; an entry found missing from
  the plan goes into the report as a finding.
- Mark an entry verified because it "should" work, or because a test in the repository covers it.
- Change the environment beyond what checking an entry needs; note in `oplog.md` everything you
  changed.
