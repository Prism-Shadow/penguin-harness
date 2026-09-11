# API Key Rotation, Health Telemetry, and Windows Git Bash Shell Resolver

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#696](https://github.com/Prism-Shadow/penguin-harness/pull/696)

[中文版](2026-09-11-key-rotation-and-shell-resolver.zh.md)

Added native API key rotation across healthy endpoints with rate-limit cooldowns (HTTP 429) and permanent key eviction on authentication failures (HTTP 401). Fixed the Windows shell executable detection to prevent delegating drive paths to WSL bash.

## Details

- **Core Key Rotator (`ApiKeyRotator`) & Subagent Allocation:**
  - Parses multiple API keys configured as arrays or delimited strings (newlines, commas, semicolons).
  - Distributes inference requests across healthy keys via round-robin or subagent allocation strategies (`auto`, `least_busy`, `round_robin`, `dedicated`, `inherit`).
  - Implements active concurrency lease tracking (`activeLeases`) to prevent subagents from colliding on the same credential, releasing leases automatically upon completion, abort, or eviction.
  - Automatically cooldowns keys on HTTP 429 rate limit responses with backoff timers, failing over to alternative healthy keys immediately.
  - Permanently evicts invalid keys on HTTP 401 unauthorized errors until manually reset or reconfigured.
  - Tracks telemetry metrics including success count, failure count, cooldown expiration, active leases, and last used timestamps.
- **Subagent Resumability:**
  - Preserves subagent session state and history on abort, interruption, or step failure (`wasAbortedOrInterrupted`) rather than discarding the child session.
  - Added `resume?: boolean` parameter to `input_subagent` tool allowing callers to resume paused/interrupted runs from their last checkpoint.
  - Added `POST /api/projects/:projectId/sessions/:sessionId/subagents/:childSessionId/resume` endpoint and frontend **Resume** action button in the Subagents view.
- **Server Health Telemetry & Reset API:**
  - Process-local `ModelKeyHealthService` exposes a masked registry per model with `activeLeases`; it is separate from live Session rotators and is not durable across restart.
  - Exposed `GET /api/projects/:projectId/models/keys/health` and `POST /api/projects/:projectId/models/keys/reset` endpoints.
  - Raw API keys are never exposed in server logs or API responses; only safe prefixes and suffixes (`sk-...1234`) are transmitted.
- **Web UI API Tracker Dock Panel & Multi-Key Controls:**
  - Added dedicated **API Tracker** dock panel with three real-time tabs: Key Health (masked keys, tone badges, active leases, countdown timers, success rates), Error Logs (live error stream with status codes), and Usage & Cost summary.
  - Multi-key configuration textarea toggle in the model settings modal with live status chips and manual reset.
  - Subagents view provides direct **Resume** action for interrupted or failed subagent sessions.
  - Full bilingual localization (English / Chinese) across all new UI panels and alerts.
- **Windows Shell Resolver (`isWslExecutable`):**
  - Added proactive inspection against WSL bash (`System32\bash.exe`, `wsl.exe`) on Windows systems.
  - Probes Git for Windows `bash.exe` (`%ProgramFiles%\Git\bin\bash.exe` and `PATH`) to ensure Windows drive paths execute reliably without POSIX mount path collisions.
- **Documentation:**
  - Updated `README.md` and `README.zh.md` with subagent key strategies, rate limit backoff, subagent resumability, and the API Tracker panel.
  - Updated `packages/docs/content/` (`models`, `tools`, `web-app`, `server-api` in English and Chinese) documenting the complete architecture and interfaces.
