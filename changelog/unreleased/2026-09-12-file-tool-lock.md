# edit_file and write_file serialize per file

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#709](https://github.com/Prism-Shadow/penguin-harness/pull/709)

[中文版](2026-09-12-file-tool-lock.zh.md)

`edit_file` and `write_file` hold a per-file mutex across their whole read-modify-write. Both tools
read a file, compute the new content and replace it with an atomic temp-file + rename, and the
engine runs a turn's approved tool calls concurrently — so two edits of one file, whether from one
turn or from two subagents in the same process, both read the original bytes and the later rename
won. One edit was silently lost while both calls reported success.

## Details

- **The key is the file's real path**, so every name that reaches one file folds onto one key: a
  symlink and the file it points at, a path crossing a linked directory. A path that does not exist
  yet keys on its real directory plus the name it will take, so a `write_file` that creates the file
  and an `edit_file` that follows share one key. A path that cannot be resolved at all keys on
  itself rather than raising, leaving the tool's own error wording intact.
- **The lock spans the read and the write**: stat, read, match, atomic write. The diff rendering and
  the tool's output happen after it is released. A call interrupted while queued behind another
  writer ends as `aborted`, the same as one interrupted during its own read or write.
- **An `old_string` an earlier edit removed now fails.** Two concurrent edits of the same
  `old_string` without `replace_all` end as one replacement plus the existing `old_string not found`
  message, instead of the second edit overwriting the first.
- **`read_file` takes no lock** — the atomic rename already leaves a reader with either the old
  content or the new one, never a mix.
- **The scope is one process.** No OS-level file lock is taken, so a separate CLI run, an editor or
  the user's own shell writing the same file is not serialized against these tools.
- **Tests** cover the tools and the mutex separately: eight concurrent edits of one file losing
  none, the same-`old_string` pair, a `write_file` racing an `edit_file` over content both match, and
  edits arriving through a symlink and through its target; plus arrival order, a failing caller, an
  interrupted caller that never runs, a queue that leaves no entry behind, and the key of a file that
  does not exist yet.
