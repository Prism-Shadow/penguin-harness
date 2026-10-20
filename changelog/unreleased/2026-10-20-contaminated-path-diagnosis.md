# A file path carrying another argument's text is named as such

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[中文版](2026-10-20-contaminated-path-diagnosis.zh.md)

A gateway or a model sometimes serializes two arguments into one string: the `file_path` arrives holding a line break and a stray `">` where the next key should have started. Read as a path it simply does not exist, and `File not found: <the whole blob>` sends the model hunting for a file that never existed — it re-issues the same malformed call, and a run that repeats one call is cut off by the `tool_loop` cutoff.

## What it does

`read_file` and `edit_file` now recognize that shape and say what it is: the path carries a line break / a stray quote and colon / far more text than a path holds, two arguments were serialized into one string, and the fix is to send the path alone in `file_path` and the text to match in its own `old_string`.

A path that looks like a path is unaffected: the diagnosis only ever replaces the wording of a failure that already happened, and never turns a working read into an error.
