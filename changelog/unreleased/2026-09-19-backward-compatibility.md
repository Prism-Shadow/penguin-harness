# Activity candidate storage migration

- **Date:** 2026-09-19
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#3](https://github.com/nicolaepocroianu/penguin-harness/pull/3), [#9](https://github.com/nicolaepocroianu/penguin-harness/pull/9), [#15](https://github.com/nicolaepocroianu/penguin-harness/pull/15), [#16](https://github.com/nicolaepocroianu/penguin-harness/pull/16), [#20](https://github.com/nicolaepocroianu/penguin-harness/pull/20), [#21](https://github.com/nicolaepocroianu/penguin-harness/pull/21)

Migration 12 moved existing candidate text from activity run JSON into a separate payload table and retained compact history metadata, without resetting drafts or run history.

## Compatibility

Restart the server to apply this one-time migration. Hot replacement refuses it because older writers embedded candidates in the metadata row. Before running an older binary against the upgraded database, roll migration 12 back with the migration runner or restore a pre-upgrade backup. Its rollback restores inline candidate text, including invalid specification output.

Repository maintainers retain the conversion and rollback as migration history until the minimum supported database schema no longer permits version 11. Runtime readers use only the migrated format.

## Module assembly storage

Migration 13 added a separate module-run identity table without rewriting existing specification records. Restart the server before starting module assembly. Rollback refuses databases containing module attempts, because an older runtime would interpret those attempts as specification generation. Restore a pre-upgrade backup before downgrading such a database. Repository maintainers retain this migration until schema versions below 13 cease to be supported.

## Media draft extension

Media plans added an optional `mediaPlan` field to the authoritative draft file. Drafts without this field retained their existing content revisions and assembly behavior; no database migration or reset was required. Once a plan was saved, its contents participated in the draft revision and carried the source specification hash.

Repository maintainers retain the optional-field format permanently as support for activities without media planning. It is not a temporary dual-format reader. Before downgrading to a runtime that does not include media in revision checks, restore a pre-media backup; older writers do not enforce media conflicts or stale-plan checks.

## Speech candidate storage

Migration 14 adds a speech-run identity table without rewriting existing specification or module attempts. Restart the server to apply it. Rollback refuses databases containing speech attempts because an older collector would treat them as specification attempts. Restore a pre-upgrade backup before downgrading a database with speech history.

Accepted speech adds optional `generatedAudio` provenance to draft media assets; immutable candidate WAV files live with the activity draft. Existing media plans remain valid without this field. Native WAF exports omit Penguin's provenance. Restore a pre-speech backup before running an older writer against drafts with generated audio.

Repository maintainers retain migration 14 until schema versions below 14 cease to be supported. The optional provenance field remains permanently for activities using generated audio.

## Image candidate storage

Migration 15 adds an image-run identity table without rewriting existing attempts. Restart the server to apply it. Rollback refuses databases containing image attempts because older collectors would interpret them as specification attempts. Restore a pre-upgrade backup before downgrading a database with image history.

Accepted images add optional `generatedImage` provenance to draft media assets; immutable PNG candidates live with the activity draft. Existing plans remain valid without this field. Native WAF exports omit Penguin's provenance and preserve the accepted PNG bytes. Restore a pre-image-generation backup before running an older writer against drafts containing generated images.

Repository maintainers retain migration 15 until schema versions below 15 cease to be supported. The optional provenance field remains permanently for activities using generated images.

## Media text suggestion storage

Migration 16 adds a media-text-run identity table without rewriting prior attempts or drafts. Restart the server to apply it. Rollback refuses databases containing media text attempts because older collectors would interpret them as specification attempts. Restore a pre-upgrade backup before downgrading a database with media text history.

Accepted suggestions use the existing media manifest description and script fields. No additional draft format was introduced, and accepted media files were preserved. Repository maintainers retain migration 16 until schema versions below 16 cease to be supported.
