# Authorize a new TokenDance API key from the models page

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`, `model-catalog`
- **PR:** [#470](https://github.com/Prism-Shadow/penguin-harness/pull/470)

[中文版](2026-08-26-tokendance-oauth.zh.md)

The TokenDance group header gained an **Authorize new API key** action. It creates a new key on the user's TokenDance account through the provider's authorization page and writes it to every model in the group, so a first run no longer needs a trip to the console to copy a key out by hand.

## Details

- The built-in catalog's `ModelProviderInfo` gained an optional `oauth` descriptor — the authorization page, the exchange endpoint, and the name recorded on the minted key — set on the `tokendance` entry. The Web App renders the action for any group whose provider declares one, and the server accepts a flow only for such a group, building both URLs from the catalog rather than from the request.
- `APP_URL` became an export of the model catalog. It is sent as the flow's `app_url`, so a key minted here is stamped with the same app URL the attribution headers already carry.
- Four owner-only routes under `/api/projects/:projectId/model-oauth`: `POST /start` opens a flow and returns the page to send the user to, `GET /callback` is where TokenDance redirects, `GET /:flowId` reports how a flow ended, and `POST /:flowId/code` redeems a code the user pasted. The callback answers a small self-contained HTML page rather than JSON.
- The PKCE verifier is generated on the server, kept in memory for ten minutes, and never sent to a client; the minted key goes straight into the provider group's models without passing through the browser, and appears in no response, log line, URL or error message. A flow belongs to one user in one Project and can be redeemed once.
- The callback URL is derived from the incoming request's own URL, so loopback, a LAN address and a custom port all work without configuration; `x-forwarded-proto` and `x-forwarded-host` are honoured only under `PENGUIN_TRUST_PROXY=1`.
- A manual mode drops the callback so the authorization page shows a one-time code instead of redirecting, for the desktop shell and any deployment the redirect cannot reach. The dialog offers it alongside the redirect path.
- Completing a flow invalidates the Project's cached Session runtimes and publishes `credentials_updated`, the same follow-up the models PUT performs.
- The Server API and Models documents describe the routes and the user-facing flow in both languages.

## Compatibility

Nothing already on disk changes shape: the `oauth` descriptor lives in the code-side catalog, and the minted key is stored as the `api_key` / `created_at` pair every other credential write already uses. No configuration file, database or stored preference is migrated.

Existing Projects do not pick up catalog changes on their own — presets are copied into `.project_config.toml` when the Project is created, and the models page's "sync presets" is the only thing that updates them afterwards. The action therefore appears wherever a Project's table already holds TokenDance entries; a Project older than that group has to sync presets once before the group, and its new action, show up.
