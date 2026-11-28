# CLI Windows File-Path Shortening in Tool Previews

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1888](https://github.com/Prism-Shadow/penguin-harness/pull/1888)

[中文版](2026-11-26-cli-shorten-windows-paths.zh.md)

Updated CLI file-tool call previews (`read_file`, `edit_file`, `write_file`) to shorten deep Windows backslash paths and mixed-separator paths to their last two path segments.

## Details

- Split file paths on both `/` and `\` when shortening CLI tool-call previews, preserving `\` as the output separator for backslash-only Windows and UNC paths and `/` when the input contained forward slashes.
- Kept Windows paths with two or fewer segments such as `src\file.ts` and `C:\file.ts` unchanged.
