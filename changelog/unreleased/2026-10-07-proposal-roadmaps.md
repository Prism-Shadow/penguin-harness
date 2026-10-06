# A proposal shows the roadmaps it belongs to

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`

[中文版](2026-10-07-proposal-roadmaps.zh.md)

A proposal's list row and detail named the roadmaps whose items lead to it, and the proposal page linked each one.

## Details

- The proposal reads (`GET …/proposals` and `GET …/proposals/:number`) carried `roadmaps: { number, name, itemKey }[]`: every roadmap with an item whose delegation names the proposal — the item's approval created it, or the item adopted or linked it. company-roadmaps provided the lookup to company-proposals while it ran (`provideProposalRoadmaps`); without it the list was empty. A write's answer left the field out.
- The proposal page showed, under the title, one line per roadmap — `Roadmap #n «name» / item <key>` — linking to the roadmap and to the queue narrowed to its proposals.
- The queue's search took `roadmap:<n>` (also `roadmap:#<n>`, and negated as `-roadmap:<n>`).
