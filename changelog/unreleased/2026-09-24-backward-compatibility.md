# Backward compatibility: proposal ledgers written before scope kinds

- **Date:** 2026-09-24
- **Type:** process
- **Scope:** `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-24-backward-compatibility.zh.md)

## Scope entries without a kind become `edit`, once

A `proposals.jsonl` written by an earlier build of the company-proposals plugin has scope entries that are only a file and a name pattern. The plugin now requires every entry to carry a kind (`edit`, `new`, `delete` or `rename`). When it first loads such a ledger, it rewrites every kind-less entry as `kind: "edit"` in every revision line, writes the result through a temporary file and a rename, keeps the original next to it as `proposals.jsonl.before-scope-kinds-<timestamp>.bak`, and logs one line naming the file. A ledger with no kind-less entry is left untouched, so the migration runs once per ledger.

Where: every organization's `<orgDir>/proposals.jsonl` on a server that runs the plugin. Nothing to do by hand. An entry that was really a new, deleted or renamed file stays `edit` until its author publishes a revision with the right kind; its row then reads `missing` rather than failing the page. The backup can be deleted once the proposals read correctly.

## Compatibility

The migration (`migrateScopeKinds` and its call in the ledger load) can go once every server that ran the first build has loaded its ledgers with this one — the next release of the plugin after 53531 and the development roots have started on it. Removing it is that function, its call and its test; a kind-less entry left on disk after that would read without a kind.
