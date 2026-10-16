# Vendor environment keys follow the Project config's official flag

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **Breaking:** yes — only rows of an `official` group that name no base URL of their own may use a vendor environment variable, and `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` are no longer read

[中文版](2026-10-15-official-provider-groups.zh.md)

Whether a keyless model may use a vendor's environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …) is now read from the Project config. A group's `[providers.<id>]` table gained a boolean `official`: the group's endpoint is its vendor's own. Core decides from that flag alone and no longer reads catalog data to judge a destination.

## The rule

- A key on the model, or the group's key that reaches it, is used as written.
- A model with neither may use the environment only when its group is `official = true` and the model names no `base_url` of its own. With no group base URL, nothing is handed over and MMSP's client reads its own variable pair, a `*_BASE_URL` set beside the key included. With a group base URL, the variable of the effective `client_type` is read and passed explicitly; an unset variable, or no protocol to name one, is refused.
- Every other keyless model is refused with "has no API key": gateways, Penguin Go, ModelScope, custom, vLLM, user-created groups, and any model with a base URL of its own, the vendor's own endpoint included. A model on the `mmsp` client with a base URL is still sent no key.

## Who sets the flag

- A new Project marks the seven first-party groups `official = true`: DeepSeek, Google, OpenAI, Anthropic, Z.AI, Moonshot and MiniMax. **Add new models** and **Restore defaults** write the same tables.
- Writing a group's base URL or protocol through the Models page, the API (`PUT /models`, `PUT /models/providers/:provider`) or `penguin config model add --provider` recomputes it: `true` while the base URL is absent or one of the vendor's own endpoints and the protocol reads the vendor's variable. Such a group with a base URL and no protocol also gets the vendor's official client as its `client_type`. Other groups carry no flag. A value edited by hand in the file is followed.
- Existing files gain the flag once, on the server's first read; see [data compatibility](2026-10-15-backward-compatibility.md). The server reads every Project's file once as it starts, so a Session opened right after an upgrade sees the flag too.
- `GET /models` reports `official` on each group, and the group settings dialog, the model dialog's hint, the masked preview, the balance query, the machine sync's report and `penguin config model list` all follow it.

## Penguin Go and ModelScope

Both take their key from the group's connection only. `PENGUIN_GO_API_KEY` and `PENGUIN_GO_BASE_URL` are no longer read by Sessions, probes, protocol detection or the balance query. A keyless Penguin Go model is sent to its relay without a key. The terminal still strips the two names from its environment.

## SDK

- `listEndpointModels` takes its key from the caller only; the host decides what the environment lends to a URL.
- `resolveModelCredential`, `modelEnvFallback` and `resolveProviderModelEnv` were removed. `resolveEntryCredential` applies the rule above, `environmentKeyRoute` reports it, and `keylessEndpoint` takes `(clientType, baseUrl)`.
- The connection rules moved to `@prismshadow/penguin-core/model-connection`, a browser-safe subpath: `MMSP_CLIENTS`, `canonicalClientType`, `sameEndpoint`, `effectiveConnection`, `groupKeyReaches`, `resolveEntryCredential` and `ModelCredentialError`. The root export still carries them.

## Compatibility

- A keyless model that relied on an environment key through a destination the old rule accepted, but the new one does not, is refused: a custom or user-created group's model with no base URL, or a model naming a vendor endpoint as its own base URL. Put the key on the model or its group, or, for a vendor group, clear the model's own base URL.
- A group whose flag was turned off by hand, or that points at a proxy, lends nothing. Set `official = true` by hand only for an endpoint that is really the vendor's.
- If you set only `PENGUIN_GO_API_KEY`, reconnect Penguin Go from its group header, or paste the key into its group settings.
- SDK callers of `listEndpointModels` pass the key themselves; callers of the removed functions use `resolveEntryCredential`.
