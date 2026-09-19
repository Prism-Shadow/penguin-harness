# Media bindings in generation input

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`
- **PR:** [#19](https://github.com/nicolaepocroianu/penguin-harness/pull/19)

Activity generation input retained the approved media manifest and generated-audio provenance while omitting internal requirement and specification hashes. Those hashes track editorial changes rather than media file checksums; a native WAF assembly had incorrectly reported an unchanged image as unverified after comparing the two.

Stored drafts kept their reconciliation metadata and existing revision checks. Existing Session input files were left intact; new generation attempts received the focused media input.
