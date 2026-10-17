# Vendor environment keys apply only where no base URL is set

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166)
- **Breaking:** yes — a model sent to a base URL from the Project config never uses an environment key, the vendor's own endpoint included; `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` are no longer read

[中文版](2026-10-15-environment-keys-without-base-url.zh.md)

Whether a keyless model uses a vendor's environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …) is now decided from the Project config alone, by one rule. Core no longer reads catalog data or any environment variable to judge a destination.

## The rule

- A model's base URL, protocol and API key each resolve from the file: the model's own value, else its group's `[providers.<id>]` value. The group key reaches a model only when the model has no base URL of its own or one on the group's origin, as before.
- A model with no key and no base URL on itself or its group is handed nothing: the MMSP client it routes to reads its own `*_API_KEY` and `*_BASE_URL`, so the key and the endpoint both come from the server's environment.
- A model with no key that is sent to a base URL from the file is refused with "has no API key" before any request, whatever the environment holds and whichever endpoint the URL names. The message names the URL and both fixes: put the key in the file, or clear the base URL and set the vendor's `*_API_KEY` (with `*_BASE_URL` when the endpoint is not the client's default) when the model pins a protocol. A model on the `mmsp` client with a base URL is still sent no key: an open MMSP server.
- To use a vendor variable on a second vendor host (bigmodel.cn, moonshot.ai, minimaxi.com), a proxy or Bedrock, leave the base URL empty and set the vendor's `*_BASE_URL` beside the key.

## What follows the rule

- A new Project writes no table for the seven first-party groups (DeepSeek, Google, OpenAI, Anthropic, Z.AI, Moonshot, MiniMax), so their keyless models read the vendor's variable. The gateways' tables carry their base URL, so their models need a key in the file.
- A custom, vLLM or user-created model with no base URL anywhere reads its protocol client's pair, `OPENAI_*` for the OpenAI-compatible protocols. The models page shows that variable when it is set, and the model dialog adds that requests go to the client's default endpoint, or to `OPENAI_BASE_URL` when it is set.
- `GET /models`, the model dialog's hint, the group settings hint, the machine sync's report and `penguin config model list` name a variable only for a model with no key and no base URL anywhere, and the group settings hint only for a group with no base URL.
- The add-group endpoint listing and protocol detection always have a URL, so they never read the environment: a listing with no key is refused (except an MMSP server), and detection with no key probes anonymously.
- The DeepSeek balance uses `DEEPSEEK_API_KEY` only while the group has no group key and no base URL; no gateway is ever lent a variable for its balance.
- The zhipu and moonshot notes in the model dialog name `ZAI_BASE_URL` / `MOONSHOT_BASE_URL` for a key from the vendor's second host.

## Penguin Go and ModelScope

Both take their key from the group's connection only. `PENGUIN_GO_API_KEY` and `PENGUIN_GO_BASE_URL` are no longer read by Sessions, probes, protocol detection or the balance query. A keyless Penguin Go model is sent to its relay without a key. The terminal still strips the two names from its environment.

## SDK

- `resolveEntryCredential(entry, group, override?)` takes no environment any more; it hands nothing over, returns the file's key, or throws `ModelCredentialError`.
- `effectiveConnection` reports `apiKeySource: "env"` for a model with no key and no base URL anywhere, and `"none"` for one with no key and a base URL.
- `listEndpointModels` takes its key from the caller only; with no key and no base URL it builds the client with nothing, as a Session would.
- Removed: `resolveModelCredential`, `modelEnvFallback`, `resolveProviderModelEnv`, `endpointEnvApiKey`, `VENDOR_ENDPOINTS`. `ProviderConnection` has no `official` field, and none ever shipped.
- `modelEnvPreviewKey(entry, group)` takes the model's own values, key included, and its group's table; `providerEnvFallbackKey(providerId, group)` names a variable only for a group with no base URL.
- The connection rules live in `@prismshadow/penguin-core/model-connection`, a browser-safe subpath: `MMSP_CLIENTS`, `canonicalClientType`, `sameEndpoint`, `effectiveConnection`, `groupKeyReaches`, `keylessEndpoint` (now `(clientType, baseUrl)`), `resolveEntryCredential` and `ModelCredentialError`. The root export still carries them.

## Compatibility

- A keyless model sent to the vendor's own base URL from the file, relying on the vendor's environment key, is refused. A Project from the releases whose DeepSeek and MiniMax presets wrote their vendor URL is migrated once by the server; see [the compatibility entry](2026-10-15-backward-compatibility.md). For a URL you typed yourself, put the key on the model or its group, or clear the base URL in the group's or the model's settings and set the vendor's `*_BASE_URL` beside the key when the endpoint is not the client's default.
- A custom, vLLM or user-created model with no base URL anywhere now uses `OPENAI_API_KEY` and goes to `OPENAI_BASE_URL` or api.openai.com. Give it a base URL, and a key, when it should reach your own server.
- If you set only `PENGUIN_GO_API_KEY`, reconnect Penguin Go from its group header, or paste the key into its group settings.
- SDK callers of `listEndpointModels` pass the key themselves; callers of `resolveEntryCredential` drop the fourth argument; callers of the removed functions use `resolveEntryCredential` or `effectiveConnection`.
