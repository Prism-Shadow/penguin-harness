# Penguin Go: a built-in model group whose key is authorized from the Models page

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `desktop`, `docs`
- **PR:** [#716](https://github.com/Prism-Shadow/penguin-harness/pull/716)

[中文版](2026-09-16-penguin-go.zh.md)

The model catalog gained a **Penguin Go** group (`penguin-go`), the relay at `https://token.penguin.ooo/api`, placed after TokenDance. Its header offers the same "authorize a key" action as TokenDance, backed by the platform's own device flow, and a **Sync** action that refreshes the group from the platform's catalog with the key already stored.

## Details

- The group ships preset rows for the Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite and 3.1 Pro (Preview) models on the Google protocol, and `deepseek-flash` (**DeepSeek V4.1 Flash**) and `deepseek-v4-pro` (**DeepSeek V4 Pro 0813**) on the DeepSeek client. The rows carry list prices; the platform's promotions arrive with authorization and Sync (see [promotions stored outside the Project file](2026-09-16-model-promotions-in-database.md)).
- **Authorize key** runs through the server: `POST /api/projects/:projectId/platform-auth/start` registers a device secret with the platform and returns a local flow id and the authorization URL, `GET …/:flowId/status` polls the one-time delivery, and `…/retry` and `…/cancel` retry a failed write or abandon the flow. Owners only. The device secret and the delivered key stay in the server process; flows expire within ten minutes. On success the key is written across the group's rows and the platform catalog adds any missing models.
- **Sync** (`POST /api/projects/:projectId/platform-auth/sync`, owner) fetches the platform catalog with the stored key, adds missing models, refreshes list prices, protocols and promotions, and never deletes a local row. It reports "added N, updated M" or "already up to date" like Sync presets; a key the platform rejects sends the owner back to authorization.
- The platform's responses are validated (size, client id, key length, model ids, routes, endpoints, context and output limits, vision flags, USD pricing and discount consistency) before anything is written. A platform 429 surfaces as HTTP 429 with `Retry-After`.
- The group's credential resolves from `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` for both protocols, never from the Google or DeepSeek variables, and connectivity, vision and protocol probes use it. A model added to the group by hand requires the relay base URL.
- The platform origin is server configuration, `PENGUIN_GO_ORIGIN` (default `https://token.penguin.ooo`): HTTPS only, plain HTTP accepted for loopback integration environments.
- The desktop shell opens the authorization page in the system browser, so Windows no longer shows a protocol-selection prompt for `about:blank`.
