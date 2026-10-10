# Add or remove one roadmap item without rewriting the draft

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `company-roadmaps`, `agent-company-proposals`, `cli`

[中文版](2026-10-07-roadmap-item-add.zh.md)

Two roadmap Actions changed one item of a discussing roadmap's draft and left the other items, the record and the body as they were.

## Details

- `roadmap.item.add` (subject `roadmap:<n>`) appended one item, its params the item itself, checked as an element of `roadmap.draft`'s `items`; its `stackedOn` could name any item already in the draft. A key the draft had was refused 409 `item_exists`.
- `roadmap.item.remove { key }` removed an item, refused 409 `item_has_proposal` for one that stood for a proposal (adopted, or linked by an approval) and 409 `item_stacked_on` for one another item was stacked on; an unknown key answered 404 `item_not_found`.
- Both had `roadmap.draft`'s default guard: only while the roadmap discusses.
- `roadmap.draft` still replaced the whole item list; its answer listed the keys that replacement removed (`removed`).
- The CLI gained a `penguin org roadmap item` group: `item add <number>` runs `roadmap.item.add` with the item's fields as command flags (`--key`, `--kind`, `--title` and `--brief` required; `--owner`, `--employees`, `--cites`, `--stacked-on` and `--proposal` optional, the lists comma-separated), and `item remove <number> <key>` runs `roadmap.item.remove` — each the same route `penguin org action run` posts to, so adding one item is no longer a JSON object written by hand. The `penguin-proposal` skill (`agent-company-proposals` 2026.10.07.2) still runs both through `penguin org action run` and names `roadmap.item.add` the way to add an item.
