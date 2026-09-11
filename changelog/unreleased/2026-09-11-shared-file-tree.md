# The plugin library's file browser draws the Workspace's tree

- **Date:** 2026-09-11
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#685](https://github.com/Prism-Shadow/penguin-harness/pull/685)

[中文版](2026-09-11-shared-file-tree.zh.md)

The Workspace panel's directory tree moved into `components/ui/file-tree.tsx`, and the plugin
detail Modal's file browser was put on it. That browser's rows had been plain buttons — a text
triangle per group, a middot per file, a border between every row, and a nested file carrying
its whole relative path in its name; they are now the rows the Files panel draws, with a
chevron, a folder or page glyph, indentation per level and the height animation on opening and
closing a directory. A skill's `reference/` became a directory row of its own instead of a
slash inside nine file names.

## Details

- The row markup, the indentation scale, the glyphs, the selected, hover and focus treatment,
  the WAI-ARIA `tree` semantics (`role`, `aria-level`, `aria-posinset`, `aria-setsize`,
  `aria-expanded`), the roving tab stop, the arrow-key walk and the `data-tree-path` /
  `data-tree-kind` attributes a caller resolves a pointer event through all went into
  `FileTree`. Data loading stayed with the callers: the Workspace panel lists one directory
  per level as it is opened, the plugin browser groups the single listing it already holds.
- The row shape, `subtreeEnd` and `treeKeyStep` moved from `lib/workspace-tree.ts` to
  `lib/file-tree.ts`, with their test cases. Stepping out of a row now takes the parent from
  the row above it rather than from its path, so a tree whose top-level rows are whole paths
  (`skills/<name>`) steps onto a row that exists.
- `WorkspaceTreeView` kept what only the Workspace has: the size and modified time in a row's
  tooltip and after its name, the upload directory standing in for a selection while no file is
  open, and the three things an empty row list can mean.
