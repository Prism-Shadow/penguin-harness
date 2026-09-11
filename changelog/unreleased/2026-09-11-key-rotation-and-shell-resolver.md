# API Key Rotation, Health Telemetry, and Windows Git Bash Shell Resolver

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#679](https://github.com/Prism-Shadow/penguin-harness/pull/679)

[中文版](2026-09-11-key-rotation-and-shell-resolver.zh.md)

Added native API key rotation across healthy endpoints with rate-limit cooldowns (HTTP 429) and permanent key eviction on authentication failures (HTTP 401). Fixed the Windows shell executable detection to prevent delegating drive paths to WSL bash.

## Details

- **Core Key Rotator (`ApiKeyRotator`):**
  - Parses multiple API keys configured as arrays or delimited strings (newlines, commas, semicolons).
  - Distributes inference requests across healthy keys via round-robin.
  - Automatically cooldowns keys on HTTP 429 rate limit responses with backoff timers, failing over to alternative healthy keys immediately.
  - Permanently evicts invalid keys on HTTP 401 unauthorized errors until manually reset or reconfigured.
  - Tracks telemetry metrics including success count, failure count, cooldown expiration, and last used timestamps.
- **Server Health Telemetry & Reset API:**
  - In-memory `ModelKeyHealthService` aggregates masked key health reports per model.
  - Exposed `GET /api/projects/:projectId/models/keys/health` and `POST /api/projects/:projectId/models/keys/reset` endpoints.
  - Raw API keys are never exposed in server logs or API responses; only safe prefixes and suffixes (`sk-...1234`) are transmitted.
- **Web UI Multi-Key Configuration & Status Chips:**
  - Added multi-line / comma-delimited key configuration textarea in the model settings modal.
  - Rendered live status chips with semantic tones (`tone.ts`): Emerald for active healthy keys, Amber for keys cooling down with real-time countdown, and Red for evicted keys.
  - Added a "Reset Keys" action to instantly clear cooldowns and re-enable evicted keys.
- **Windows Shell Resolver (`isWslExecutable`):**
  - Added proactive inspection against WSL bash (`System32\bash.exe`, `wsl.exe`) on Windows systems.
  - Probes Git for Windows `bash.exe` (`%ProgramFiles%\Git\bin\bash.exe` and `PATH`) to ensure Windows drive paths execute reliably without POSIX mount path collisions.
