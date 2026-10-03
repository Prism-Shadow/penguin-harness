# Backward compatibility: proposal ledgers written before scope kinds and declared test groups

- **Date:** 2026-09-24
- **Type:** process
- **Scope:** `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-24-backward-compatibility.zh.md)

## Scope entries without a kind are read as `edit`

A `proposals.jsonl` written by an earlier build of the company-proposals plugin has scope entries that are only a file and a name pattern. The plugin now gives every entry a kind (`edit`, `new`, `delete` or `rename`); an entry written without one is read as `kind: "edit"` when the ledger loads. The file on disk is never rewritten — the reading happens in memory, and every revision published from now on is stored with explicit kinds.

Where: every organization's `<orgDir>/proposals.jsonl` on a server that runs the plugin. Nothing to do by hand. An entry that was really a new, deleted or renamed file stays `edit` until its author publishes a revision with the right kind; its row then reads `missing` rather than failing the page.

## Tests in a group that is not declared stay as published

The test groups a proposal may use are now declared in the plugin's configuration (Settings → Plugins → Company proposals). A revision already in a ledger whose tests use a group that is not declared — one published before the declaration, or a group an admin later takes out — is kept as it is: the file is not rewritten, the page shows those tests last under "Undeclared groups" and `show` marks them, and only the next publish must move them into a declared group (400 `tests_group_undeclared` until it does).

Where: every organization's `<orgDir>/proposals.jsonl` on a server that runs the plugin. Nothing to do by hand; an admin who wants such a group kept declares it.

## Compatibility

The read-side default (`migrateScopeKinds` and its call in the ledger load) stays for as long as ledgers written before kinds exist; it is one branch over the revision lines. It can go only after every such ledger has been rewritten by a later decision — until then, removing it would leave old entries without a kind.

The "Undeclared groups" fallback on the page and in `show` stays while an open proposal still carries an undeclared group. Whoever maintains the proposals plugin checks at the next release preparation and removes it once none does; after that, taking a group out of the declaration would hide those rows instead of listing them.
