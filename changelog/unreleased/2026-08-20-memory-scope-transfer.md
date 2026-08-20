# Memory groups export and import as a whole

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#372](https://github.com/Prism-Shadow/penguin-harness/pull/372)

[中文版](2026-08-20-memory-scope-transfer.zh.md)

Each scope group on the Memory tab — user memory, and one per Workspace — now moves in one
piece. Export downloads the group as a single JSON document holding every memory and the
group's `MEMORY.md`; import reads such a document back into any group of any agent, so a
convention worked out with one agent can be handed to another, or a Workspace's memories
carried to a second machine.

## The document

`GET /api/projects/:p/agents/:a/memory/scopes/:key/export` returns one JSON object —
`format` / `version` / `scopeKey` / `kind` / `workspacePath` / `exportedAt`, the scope's
`index`, and a `files` array of `{name, content}` — served as an attachment. Everything in a
Memory scope is UTF-8 Markdown, so the document is plain text end to end: readable in an
editor, diffable in git, and reviewable before it is imported.

## Import, and what it costs

`POST …/memory/scopes/:key/import` takes `{payload, mode?, confirm?}`:

- `skip` (the default) writes only names the group does not already have. Nothing on disk is
  replaced or deleted.
- `overwrite` replaces a same-named memory's content, leaving memories the document does not
  carry alone.
- `replace` additionally deletes every memory the document does not carry.

An import that would overwrite or delete anything is refused with 409
`memory_import_confirm_required` unless `confirm` is set — and the gate is what the import
would actually cost, not the mode's name, so `replace` into an empty group needs no
confirmation. The Web App computes the same plan before sending and puts the two destructive
modes behind a confirmation naming each memory that would be overwritten or deleted.

The index follows the files: a group with no `MEMORY.md` takes the document's, `replace`
takes it too, and a merge keeps the index that is there and appends the document's lines for
the memories that arrived — the mirror of the pruning a delete already does. Only the indexes
enter the model's context, so an unindexed memory would be one the agent never reads.

## Validation and access

Entry names go through the same check that guards every other write into a Memory directory:
a plain Markdown topic name, no path, no leading dot, not the reserved index, re-checked for
containment after resolution. A document is refused whole — nothing is written — when an entry
name is a path or climbs out, when content is not a string or carries a NUL, when a name
repeats, or when it exceeds 500 entries, 512KB per file or 8MB in total. Writes go to a
temporary file and are renamed over the target, so a symlink standing at a memory's name is
replaced rather than followed.

Export is available to any Project member, as reading the files one by one already was.
Import is owner-only, matching the Agent State snapshot's split, and enforced on the server:
a member gets 403 `owner_required`, a non-member 404 on both routes.

## Web App

Each group header carries an export and (for owners) an import control beside its existing
Add entry. Import opens a modal naming the picked file and its memory count, with the
collision choice spelled out, then reports what the import did — added, replaced, deleted —
as a toast.
