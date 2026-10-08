# Activity studio: the Build section under the stages is gone

- **Date:** 2026-10-08
- **Type:** refactor
- **Scope:** `web`, `server`

**Assembly runs from the stages.** The Build section under the stages listed checks that
repeated the stages above it, and its **Assemble WAF module** button did the same as the
Assemble module stage. It is removed, along with its last-assembly line and its book
reading-mode picker.

**A book's reading mode is chosen when it is created.** Choosing **Book** in New activity
asks for Read-along or Decodable, and the activity is not created without one. The mode
belongs to the product, so a later ref of the same book keeps the first ref's mode.
