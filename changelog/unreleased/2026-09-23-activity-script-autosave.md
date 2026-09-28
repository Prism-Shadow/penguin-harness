# Activity Script autosave

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Activity Script now saves itself five seconds after the author stops typing, as Loom's
script editor did. Its header shows where saving stands: unsaved, saving, saved, or not
saved.

## Details

- An autosave goes through the same route and revision check as **Save script**. On a
  conflict it stops and shows the message, and nothing is overwritten.
- Autosave holds off while a run or a stage sequence is in flight, so it never moves the
  draft under running work. The header says so, and the save happens once the work ends.
- Text typed while a save is in flight stays in the editor. The editor stays editable
  during any save.
- An autosave does not raise the "Saved" notice. The editor's own status says it.
