# Custom models: protocol detection from the base URL

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`
- **PR:** [#324](https://github.com/Prism-Shadow/penguin-harness/pull/324)

[中文版](2026-08-18-custom-model-protocol-detect.zh.md)

Custom and user-defined groups are no longer pinned to one protocol: a new custom model starts with no protocol selected, and a **Detect** action in the Web dialog probes which of AgentHub 0.4.2's generic protocol clients a custom base URL serves and stores it as the entry's `client_type`. The probe order is `openai-responses` (OpenAI Responses API) first, then `ant-messages` (Anthropic Messages API), then `openai-chat` (Chat Completions; bare `openai` stays its alias), and the first hit wins.

## Server

- New `POST /api/projects/:id/models/detect` (owner): probes the base URL sequentially in the order above — the paths and auth headers are exactly what the AgentHub clients construct (`POST {base}/responses` and `POST {base}/chat/completions` with `Authorization: Bearer`; `POST {base}/v1/messages` with `x-api-key` + `Authorization: Bearer` + `anthropic-version`) — and stops at the first protocol the endpoint serves, reporting per-probe outcomes for debugging.
- Probes are minimal invalid requests (`{}` bodies, 5s timeout each, response bodies read up to 64 KiB so a flooding endpoint is abandoned rather than buffered): zero tokens billed, no model id needed, and keyless probing works — a 401/403 in the protocol's error shape proves the route. Classification separates route-exists (structured API errors, tolerant of OpenAI / Anthropic / vLLM / FastAPI dialects) from route-missing (404/405 by status alone), gateway junk (HTML / non-JSON / shapeless bodies, catch-all 200s), and 5xx (proves nothing about the path). Credential resolution has three layers: the key sent in the request, else the stored key named by the optional paired reference, else the environment variable belonging to the protocol **that probe** speaks — `ANTHROPIC_API_KEY` for `ant-messages`, `OPENAI_API_KEY` for the two OpenAI protocols, resolved through the same `resolveModelEnv` mapping the saved model reads. Resolution is per probe because the protocol is precisely what is being determined. Env values are read server-side only and never reach the browser, the response, or the logs.

## Web App

- **Detect** sits at the top-right of the base URL field, next to its label — the same placement idiom as the API key field's "get API key" link — and is always clickable: no API key is needed, because the server resolves the probe credential itself (below). Detection also still runs when the base URL field is left after a change.
- **Saving detects first.** Confirming the dialog while the protocol is still unset runs detection and then continues the save with the result, with the confirm button locked and reading "Detecting…" for the round-trip. A probe that finds nothing aborts the save and leaves the dialog open on top of the popup, so the protocol can be picked by hand or the URL corrected — never a silent save. This is load-bearing: AgentHub resolves an unmatched client type by throwing rather than defaulting, so an entry persisted without a protocol is a model that cannot start. `rowToEntry` keeps the same guarantee for the paths that do not probe (set-default, set-vision-proxy, remove), and preset / vendor entries still persist an empty value so AgentHub keeps inferring from the model id.
- **Detection failures pop up** an alert dialog (the new `AlertModal`, the ConfirmModal card with a single dismiss button) rather than only a muted line, and say which case it was: every probe failed to connect, versus the endpoint answered but serves none of the three paths. A hit still reports itself as one green line under the field.
- The path suffix the dialog already showed inside the right edge of the base URL field (`/responses`, `/v1/messages`, `/chat/completions`) became the manual protocol picker: the passive grey text turned into a borderless in-field trigger listing the three protocols with the path each appends and a checkmark on the current one, so protocol selection took no new form row. Selection needs no API key, which keeps a keyless endpoint configurable by hand.
- The suffix tracks the choice live and reflects a run in progress (spinner, and amber when nothing matched or the probe failed) at unchanged width, so the input's reserved padding never shifts. The verdict ("Detected OpenAI Responses; applied", or why nothing matched) appears in the field's own message line only after a run.
- Legacy entries keep their stored value: `openai` displays as Chat Completions without being rewritten until the user picks or a detection applies; vendor-pinned client types outside the generic family keep the read-only note. Moving a model to Custom now keeps a generic protocol client type instead of forcing `openai-chat` the way [the earlier grouping fix](2026-08-14-model-group-protocol.md) did.

## Core

- `resolveModelEnv` routes `ant-messages` to the `ANTHROPIC_*` env pair (`openai-responses` / `openai-chat` already resolved to `OPENAI_*`), so the dialog's env-fallback hint follows the detected protocol per PRN-021.

Docs: the models page (en/zh) gained a "Protocol detection for custom models" section; the configuration and server-api references picked up the new client types and the new endpoint.
