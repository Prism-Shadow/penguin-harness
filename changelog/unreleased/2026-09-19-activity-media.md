# Activity media planning and WAF asset configuration

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#15](https://github.com/nicolaepocroianu/penguin-harness/pull/15)

Activities gained a reviewable media plan derived from a saved specification. Owners could assign existing WAF media paths in a language-grouped asset manifest, with scene usages, audio scripts, and explicit unbound assets.

Rebuilding retained bindings for unchanged requirements and removed obsolete requirements. Media edits participated in draft revision checks and the editor's unsaved-change protection. Invalid identities, conflicting aliases, unsafe paths, missing required assets, and stale plans were rejected.

Module assembly received Loom-format `asset_manifest.json` and language-specific `{{MEDIA}}` configuration. Preflight rejected missing or linked references before starting a model Session, and output collection checked that assembly preserved approved bindings. Planning did not call a model, generate media files, verify checkout availability, or publish assets; assembly used normal Harness tools and approvals to copy referenced files into its preview.

Existing drafts remained readable without a media plan; see [backward compatibility](2026-09-19-backward-compatibility.md).
