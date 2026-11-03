---
name: penguin-rfc
description: Use when a design decision needs a PenguinHarness PRFC under rfcs/ — deciding whether a change needs one, drafting it from rfcs/TEMPLATE.md, picking the next number, meeting the required sections, keeping the RFC and its implementation in separate pull requests with the RFC first, answering review on a draft, and revising a landed RFC by raising its rev and recording the change under ## Changes.
version: 2026.10.19.1
---

# Contributing a design RFC

A design RFC (a **PRFC**) is one design decision written down as one document under the
repository's `rfcs/` directory: what the system does from now on, why, and what it costs.
This skill is the standard path for writing one, revising one, answering review on one,
or changing one that has landed.

The surface's rules live in `rfcs/README.md`; the contributor-facing how-to lives in the
RFC section of `.github/CONTRIBUTING.md`; the section structure lives in
`rfcs/TEMPLATE.md`. Read those three before the first use — this skill is the operating
summary, not a replacement for them.

## Does the task need an RFC?

Write one when the change is a **decision others build on**: a mechanism, an interface,
a data shape, a contract between parts. A bug fix, a refactor that changes nothing, or a
documentation fix never needs one. When unsure, ask in an issue before drafting.

## Draft a new RFC

1. **Copy the template and write the pair.** `rfcs/TEMPLATE.md` →
   `rfcs/PRFC-NNNN-<slug>.md` in English, and its Chinese counterpart
   `rfcs/PRFC-NNNN-<slug>.zh.md` with the same sections. The slug is lower-case
   kebab-case; one document carries one design decision. Each file links the other at
   the top.
2. **Take the next number.** The highest number present under `rfcs/`, plus one. Scan
   the open pull requests that touch `rfcs/` for numbers already claimed. Numbers need
   not be continuous: a new RFC takes the next number after the highest, not a gap.
   `0013` is retired; the two drafts sharing `0005` are a one-time carry-over — copy
   neither pattern.
3. **Keep the title and metadata.** The first line is `# PRFC-NNNN <Title>`, and its
   number must match the file name. Keep the `Feature Name`, `Start Date`, `PRFC PR` and
   `Implementation PR` bullets; leave a link empty until the corresponding pull request
   exists.
4. **Omit the provenance marker.** That block records where a document was migrated
   from (the design repository, its state there, its rev) and belongs only to migrated
   documents. A new RFC starts life here and needs none of it.
5. **Fill every section.** Summary, Motivation, Guide-level explanation, Reference-level
   explanation, Drawbacks, Rationale and alternatives, Prior art, Unresolved questions,
   Future possibilities — with their anchor links, and the `## Changes` section at the
   end starting at `### v1.0.0`. Delete the template's guidance comments.
6. **Write the decision, not the diff.** Mechanisms and interfaces — the shape others
   build on — not the implementation's moving parts. Be specific, name the alternatives,
   and treat Drawbacks as mandatory: "none" is rarely honest.

## The RFC and its implementation

The RFC travels in its own pull request; the implementation changes it corresponds to
never travel in it. The two merge independently, and the RFC lands **first**: an
implementation pull request references the RFC by number ("Implements PRFC-NNNN") and
is reviewed against the design the RFC fixed. When a task hands you both a design and
its code, open the RFC pull request first, say the implementation follows, and keep the
code in its own branch until the RFC has landed.

## Answering review

While the RFC is under review in its pull request, edit the body freely — there is no
version bookkeeping yet. Answer each comment in its thread. When a comment changes the
design materially, update every affected section, not just the spot the comment points
at; the Summary must still state the design as it now stands.

## Changing a landed RFC

A landed RFC is stable. Do not propose edits casually; when a change is truly needed:

1. Add a new `### vX.Y.Z` heading as the newest entry under `## Changes` — the version
   goes up, never sideways. A change that alters what the design says is a major bump
   (`v2.0.0`); a correction that only clarifies it is a minor bump (`v1.1.0`).
2. Under it, list the revision's change items — one `- Added:` / `- Removed:` /
   `- Updated:` line each, written so a reader of the previous version understands the
   delta.
3. If the document carries a `**Rev**` marker under its title (migrated documents do),
   update it to the new version.
4. Open one pull request containing only this document change.

Do not delete a landed RFC; a withdrawal is itself a revision, recorded in
`## Changes`.

## The CI gate

Pull requests that touch `rfcs/` run the Check RFCs workflow
(`.github/workflows/check-rfcs.yml`). It fails when:

- a file does not follow `PRFC-NNNN-slug.md` (four digits, lower-case kebab-case);
- two files share a number other than the known `0005` pair;
- a document loses `## Summary`, `## Motivation` or `## Reference-level explanation`;
- an existing RFC is modified without `## Changes` and a `### vX.Y.Z` heading.

Fix the document, not the check. If the check itself seems wrong, that is a conversation
in the pull request, not an edit to the workflow.

## Checklist

- File named `PRFC-NNNN-<slug>.md`; the number is the next available one and not `0013`.
- Both files of the pair are present, `<slug>.md` and `<slug>.zh.md`, each linking the other.
- Title line `# PRFC-NNNN …` matches the file's number.
- All nine sections present with their anchor links; `## Changes` starts at `### v1.0.0`.
- The pull request contains only the RFC — no implementation changes.
- For a landed RFC: a new `### vX.Y.Z` under `## Changes`, change items listed, `**Rev**`
  marker updated if the document carries one.
