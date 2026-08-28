# The dev skill records the traps a six-PR batch walked into

- **Date:** 2026-08-28
- **Type:** process
- **Scope:** `skills`
- **PR:** [#536](https://github.com/Prism-Shadow/penguin-harness/pull/536)

[中文版](2026-08-28-dev-skill-review-notes.zh.md)

`.agents/skills/penguin-harness-dev/SKILL.md` gained four notes, each written from a defect that
reached review in the batch that shipped
[#528](https://github.com/Prism-Shadow/penguin-harness/pull/528)–[#534](https://github.com/Prism-Shadow/penguin-harness/pull/534).

## Details

- Moving the default model is called out as reaching further than adding one: six documented
  first-run commands pin it by hand with `--set-default`, so leaving them on the old id undoes
  the change on every fresh install, and the `models` / `configuration` samples carry it in two
  places that have to move together.
- The changelog contract names the two fields that are actually missed — `PR`, with the `grep`
  that finds an entry without one, and the translated section headings, an English heading in a
  `.zh.md` being the common way a pair stops mirroring.
- The verification section warns that a fake written from the happy path hides the bug it was
  meant to catch, since what drifts from the real adapter is the failure contract.
- It also warns that a structural assertion true at the base commit is not a test, with the
  replay that tells them apart, and records that the local server suite drops a few tests under
  full parallel load and passes them alone.
