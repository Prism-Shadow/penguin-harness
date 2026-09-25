# Backward compatibility: proposal ledgers written before scope kinds

- **Date:** 2026-09-24
- **Type:** process
- **Scope:** `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-24-backward-compatibility.zh.md)

## Scope entries without a kind are read as `edit`

A `proposals.jsonl` written by an earlier build of the company-proposals plugin has scope entries that are only a file and a name pattern. The plugin now gives every entry a kind (`edit`, `new`, `delete` or `rename`); an entry written without one is read as `kind: "edit"` when the ledger loads. The file on disk is never rewritten — the reading happens in memory, and every revision published from now on is stored with explicit kinds.

Where: every organization's `<orgDir>/proposals.jsonl` on a server that runs the plugin. Nothing to do by hand. An entry that was really a new, deleted or renamed file stays `edit` until its author publishes a revision with the right kind; its row then reads `missing` rather than failing the page.

## Compatibility

The read-side default (`migrateScopeKinds` and its call in the ledger load) stays for as long as ledgers written before kinds exist; it is one branch over the revision lines. It can go only after every such ledger has been rewritten by a later decision — until then, removing it would leave old entries without a kind.
