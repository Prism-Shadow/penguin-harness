# A compaction threshold stated as a share of the model window

- **Date:** 2026-11-08
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`

[中文版](2026-11-08-compaction-percent-threshold.zh.md)

`compaction.max_context_percent` states the compaction threshold as a percentage of the model's context window, so one Agent follows whichever model a Session actually runs on instead of carrying a token count tuned for one of them. The Agent settings page gained a field for it.

## Details

- A positive `max_context_percent` (1–100) wins over `max_context_length`; `-1` or unset keeps the token threshold. Both forms are capped at `context_window` − 2048, so even 100% leaves the compaction request its own room, and a share that would round to zero floors at one token — `0` is the configured value that switches compaction off.
- An entry with no usable `context_window` takes its share of the assumed 128000 window, the same assumption the token form already derived from.
- The engine's compaction settings, the per-checkpoint re-read of the `compaction` section, and the `compactionThreshold` reported by `GET /api/sessions/:id/context` all follow the new field, so the composer's context ring is drawn against the threshold actually in force.
- `PUT /api/agents/:id/config` accepts `compaction.maxContextPercent` as an integer in 1–100 or `-1`, and the Agent config DTO reads it back. The seeded configuration is unchanged, so a new Agent carries no share until someone sets one.
- In the Web App the context panel's threshold cutter becomes a readout when the Agent sets a share: a token gesture written underneath a percentage that overrides it would silently do nothing. The panel names the share in force and points at Agent settings, where the percentage is edited and applies to a running conversation at once.
