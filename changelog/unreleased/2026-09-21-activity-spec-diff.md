# Review specification edits against the saved specification

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#32](https://github.com/Prism-Shadow/penguin-harness/pull/32)

A specification was edited as raw JSON with no way to see what an edit had actually
changed before saving it. The editor gained a review view comparing what is in the box
with the specification currently saved.

## The view

A line comparison, with the added and removed lines marked and numbered on the side they
belong to. Long unchanged stretches fold away to a count, because a specification is
mostly unchanged and finding the edit inside it is what the view exists to avoid. The
summary names how many lines were added and removed and how many separate regions they
form, and the previous and next actions step between those regions, wrapping at both ends.

The scenes an edit touched are named as chips, each saying whether the scene was added,
removed or changed, and each jumping to that scene in the comparison. Text that will not
parse still compares as lines; it simply names no scenes rather than guessing.

Inline and side-by-side layouts are both available. Reverting every edit is offered, and
confirmed before it discards anything.

## Details

- The raw JSON box remains the thing an author types into; the comparison is a reading of
  it, not a replacement for it.
- A draft specification has no version history, so the only base offered is the saved
  specification, which is the one a save decision is about.
- The comparison is a longest-common-subsequence match, so a moved block reads as context
  rather than as a deletion and an insertion. Its cost is the product of the two line
  counts, and past a million table cells it reports every line as replaced rather than
  building that table on every keystroke.
- A scene chip resolves to a row the view actually renders, since a scene's own
  identifier line is usually unchanged and folded away.
- The change position is clamped to the regions that currently exist, so an edit that
  removes regions cannot leave an impossible position on screen.
