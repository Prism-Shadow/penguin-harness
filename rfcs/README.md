# Design RFCs (PRFC)

This directory is PenguinHarness's design RFC surface: one design decision per document, named `PRFC-NNNN-slug.md`. Every document here was migrated from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design), where the same files live under its `rfcs/` directory. The migration collected both states: the documents landed on that repository's default branch, and the drafts still carried by its open or draft design pull requests. The landed documents are in this directory; each draft arrives in its own pull request, and until then its index row names the document without a link.

[中文版](README.zh.md)

## Conventions for this surface

1. **An RFC and the implementation changes it corresponds to are never submitted in the same pull request**; the two merge independently.
2. **Once an RFC has landed, it should not be modified frequently.**
3. **When a modification is truly needed, the version number (rev) must be raised** — e.g. `v2.0.0`.
4. **Every modification lists that revision's change items at the end of the document, under a `## Changes` section** — `### v2.0.0` with `- Added…` / `- Removed…` / `- Updated…` entries.

## Shape of a document

Each document keeps its original title line (`# PRFC-NNNN …`), metadata bullets and body; section names follow the Rust RFC template. Every RFC is a pair — `PRFC-NNNN-slug.md` in English and `PRFC-NNNN-slug.zh.md` in Chinese, the same design in both languages — and the language link at the top of each file switches between them; the index below links the English file. The migration added exactly two things to each file:

- a **provenance marker** right under the title: the source file in the design repository, its state there — landed on the default branch, or the open or draft design PR that carries the draft — and the current rev;
- a **`## Changes` section at the end**, recording every revision the document goes through, starting at `v1.0.0`.

The body carries the design repository's text. Where an RFC has pending revisions not yet integrated, the body keeps the current landed version and the provenance marker records the pending items; when the design repository settles them, the update arrives here as a rev bump with its change items listed in the `## Changes` section.

## Numbering

Numbers and filenames carry over from the design repository unchanged. Two drafts share the number `0005` — PRFC-0005-mechanisms-not-implementations.md and PRFC-0005-plugin-versioning.md — two independent design lines that each took the number before either landed; they are distinct documents, not revisions of one another. The number `0013` is retired: the HMR RFC was drafted as PRFC-0013 and renumbered to PRFC-0002 before it landed.

