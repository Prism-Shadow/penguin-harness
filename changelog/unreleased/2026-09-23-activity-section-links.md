# Link to a section of an activity

- **Date:** 2026-09-23
- **Type:** feat
- **Scope:** `web`

The section open in an activity's workspace is now kept in the address as `?section=`, so
a copied link or a reload opens the same section, for example
`/activities/<id>?section=speech`. A section the activity does not have yet, or a name
that is not a section, opens the first available one as before.
