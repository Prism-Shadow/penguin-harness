# Backward compatibility in this batch

Per the repo rule, every compatibility decision of the batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Legacy `thinking_level` in old Traces is ignored on resume (owner-directed)

Old Traces recorded a `thinking_level` in their `session_meta`; since 0.1.2 the field is no longer written, and resume used to keep honoring it when present. The owner chose explicit incompatibility over continued support: resume now ignores the field entirely and always reads the Agent's current config. **Old shape tolerated:** the field may appear in old meta JSON and is skipped without error (the Trace itself stays fully readable). **Scope:** `resumeSession` only; live behavior and the per-turn picker were never affected. **User action:** none — the one visible consequence is that a resumed legacy subagent session follows the resuming Agent's configured level instead of its spawn-time inherited one. **Removal:** nothing to remove; no compat code was retained beyond the tolerant skip.

## Existing Agents without `{{SHELL}}` get the Shell line via an assembly-time fallback

The `Shell:` environment line ships in the default `system_prompt` template through a new `{{SHELL}}` placeholder — but `system_config.yaml` is baked at Agent creation and never auto-upgraded, so every Agent created before this release lacks the placeholder, and on Windows its model would never learn which shell `exec_command` speaks. Rather than a disk migration, prompt assembly applies a narrow fallback: **on win32 only**, when the template contains no `{{SHELL}}` and the output carries no `Shell:` line already, the line is appended to the Environment block in memory. **Old shape tolerated:** pre-`{{SHELL}}` templates (and templates that hardcode their own `Shell:` line, which win). **Scope:** prompt assembly on Windows; POSIX output is byte-identical, no file is rewritten. **User action:** none; resetting an Agent's config to defaults also picks up the placeholder and makes the fallback moot for that Agent. **Removal:** delete the fallback once pre-`{{SHELL}}` Agent configs are no longer expected in the wild (tracked by the comment at the fallback site).

## Additive protocol fields need no handling

The `StopReason` enum's sixth value `auth` (old readers fall through like `failed`; old Traces never contain it), `request_end`'s `message` and `retry_in_ms`, the `credentials_updated` server event, and `updatedAt` on the models response are all additive: old Traces simply lack them, old readers ignore them, and nothing interprets legacy data differently. Recorded here only to state that the check was made; there is no compat behavior to retire.
