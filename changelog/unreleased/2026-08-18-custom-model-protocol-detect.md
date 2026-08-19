# Custom models: protocol auto-detection from the base URL

Custom and user-defined groups are no longer pinned to one protocol: the Web dialog detects which of AgentHub 0.4.2's generic protocol clients a custom base URL serves and stores it as the entry's `client_type` — `openai-responses` (OpenAI Responses API) tried first, then `ant-messages` (Anthropic Messages API), then `openai-chat` (Chat Completions; bare `openai` stays its alias).

## Server

- New `POST /api/projects/:id/models/detect` (owner): probes the base URL sequentially in the order above — the paths and auth headers are exactly what the AgentHub clients construct (`POST {base}/responses` and `POST {base}/chat/completions` with `Authorization: Bearer`; `POST {base}/v1/messages` with `x-api-key` + `Authorization: Bearer` + `anthropic-version`) — and stops at the first protocol the endpoint serves, reporting per-probe outcomes for debugging.
- Probes are minimal invalid requests (`{}` bodies, 5s timeout each): zero tokens billed, no model id needed, and keyless probing works — a 401/403 in the protocol's error shape proves the route. Classification separates route-exists (structured API errors, tolerant of OpenAI / Anthropic / vLLM / FastAPI dialects) from route-missing (404/405 by status alone), gateway junk (HTML / non-JSON / shapeless bodies, catch-all 200s), and 5xx (proves nothing about the path). Like the connectivity test, an optional paired reference lets the stored key back the probes; the key never appears in URLs, results, or logs.

## Web App

- The custom-model dialog gains a protocol row (custom / user-defined groups): detection runs automatically when the base URL field loses focus and via an "Auto-detect" button in the label row; the result ("Detected OpenAI Responses; applied") lands in the dropdown, which doubles as the manual override — when nothing matches, an inline notice says so and the choice stays manual. The grey in-field path suffix on the base URL tracks the selection live (`/responses`, `/v1/messages`, `/chat/completions`).
- Legacy entries keep their stored value: `openai` displays as Chat Completions without being rewritten until the user picks or a detection applies; vendor-pinned client types outside the generic family keep the read-only note. Moving a model to Custom now keeps a generic protocol client type instead of forcing `openai`.

## Core

- `resolveModelEnv` routes `ant-messages` to the `ANTHROPIC_*` env pair (`openai-responses` / `openai-chat` already resolve to `OPENAI_*`), so the dialog's env-fallback hint follows the detected protocol per PRN-021.

Docs: the models page (en/zh) gains a "Protocol auto-detection for custom models" section; the configuration and server-api references list the new client types and endpoint.
