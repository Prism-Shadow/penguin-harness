# Custom models: protocol auto-detection from the base URL

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`
- **PR:** [#324](https://github.com/Prism-Shadow/penguin-harness/pull/324)

[中文版](2026-08-18-custom-model-protocol-detect.zh.md)

Custom and user-defined groups are no longer pinned to one protocol: the Web dialog now detects which of AgentHub 0.4.2's generic protocol clients a custom base URL serves and stores it as the entry's `client_type`. The probe order is `openai-responses` (OpenAI Responses API) first, then `ant-messages` (Anthropic Messages API), then `openai-chat` (Chat Completions; bare `openai` stays its alias), and the first hit wins.

## Server

- New `POST /api/projects/:id/models/detect` (owner): probes the base URL sequentially in the order above — the paths and auth headers are exactly what the AgentHub clients construct (`POST {base}/responses` and `POST {base}/chat/completions` with `Authorization: Bearer`; `POST {base}/v1/messages` with `x-api-key` + `Authorization: Bearer` + `anthropic-version`) — and stops at the first protocol the endpoint serves, reporting per-probe outcomes for debugging.
- Probes are minimal invalid requests (`{}` bodies, 5s timeout each, response bodies read up to 64 KiB so a flooding endpoint is abandoned rather than buffered): zero tokens billed, no model id needed, and keyless probing works — a 401/403 in the protocol's error shape proves the route. Classification separates route-exists (structured API errors, tolerant of OpenAI / Anthropic / vLLM / FastAPI dialects) from route-missing (404/405 by status alone), gateway junk (HTML / non-JSON / shapeless bodies, catch-all 200s), and 5xx (proves nothing about the path). Like the connectivity test, an optional paired reference lets the stored key back the probes; the key never appears in URLs, results, or logs.

## Web App

- The path suffix the custom-model dialog already showed inside the right edge of the base URL field (`/responses`, `/v1/messages`, `/chat/completions`) became the protocol control itself: the passive grey text turned into a borderless trigger inside the field, so the picker took no new form row. Clicking it opens a menu whose first row re-runs auto-detection and whose remaining rows are the three protocols, each with the path it appends and a checkmark on the current one; picking one is the manual override.
- Detection still fires on its own when the base URL field loses focus, the suffix tracks the choice live, and the verdict ("Detected OpenAI Responses; applied", or why nothing matched) appears in the field's own message line only after a run. The trigger turns amber when nothing matched or the probe failed, at unchanged width so the input's reserved padding never shifts.
- Legacy entries keep their stored value: `openai` displays as Chat Completions without being rewritten until the user picks or a detection applies; vendor-pinned client types outside the generic family keep the read-only note. Moving a model to Custom now keeps a generic protocol client type instead of forcing `openai` the way [the earlier grouping fix](2026-08-14-model-group-protocol.md) did.

## Core

- `resolveModelEnv` routes `ant-messages` to the `ANTHROPIC_*` env pair (`openai-responses` / `openai-chat` already resolved to `OPENAI_*`), so the dialog's env-fallback hint follows the detected protocol per PRN-021.

Docs: the models page (en/zh) gained a "Protocol auto-detection for custom models" section; the configuration and server-api references picked up the new client types and the new endpoint.
