# Review suggested image prompts and narration scripts

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#21](https://github.com/nicolaepocroianu/penguin-harness/pull/21)

Activities gained text suggestions for existing image prompts and narration scripts through normal Harness Sessions. Authors reviewed the original and proposed text before explicitly applying a suggestion. Changes stayed within the selected language and asset; scenes, media paths, accepted files, and other assets were preserved.

Suggestions from older drafts remained available for inspection but could not overwrite current edits. Image and speech generation remained separate actions after text review.

Restart and downgrade handling were documented in [backward compatibility](2026-09-19-backward-compatibility.md).
