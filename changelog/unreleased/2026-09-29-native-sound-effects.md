# Native AudioGen and AudioLDM sound effects

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `web`, `desktop`, `tooling`

Added native Node adapters for `facebook/audiogen-medium` and `cvssp/audioldm-s-full-v2` to Activities' local-audio capability. The adapters loaded revision-pinned safetensors into ONNX Runtime, with no Python runtime or AgentHub dependency.

Sound effects gained local provider choices, clips from 1 to 10 seconds, and the existing cancellable generation, candidate review, and acceptance flow. Model downloads used checksum verification and an atomic cache. Worker modules were included in server, desktop, and hot-update bundles.
