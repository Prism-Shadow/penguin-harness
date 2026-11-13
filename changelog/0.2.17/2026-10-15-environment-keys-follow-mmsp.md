# Environment keys follow MMSP's rule

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1166](https://github.com/Prism-Shadow/penguin-harness/pull/1166)
- **Breaking:** yes — a keyless model on a vendor's second official host no longer uses the vendor's environment key; `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` are no longer read; the SDK's credential helpers were replaced

[中文版](2026-10-15-environment-keys-follow-mmsp.zh.md)

Whether a keyless model uses a vendor's environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, …) became MMSP's rule alone, from MMSP 0.5.4, which carries MMSP [#258](https://github.com/Prism-Shadow/model-message-stream-protocol/pull/258) and which the harness now requires. PenguinHarness resolves each model's key, base URL and protocol from the Project config and hands them to MMSP as they are. It reads no environment variable to decide where a request goes, and refuses nothing itself.

## The rule

- A model's base URL, protocol and API key each resolve from the file: the model's own value, else its group's `[providers.<id>]` value. The group key reaches a model only when the model has no base URL of its own or one on the group's origin, as before.
- MMSP's client uses a key it is handed. With none, it reads its own `*_API_KEY` only when it is handed no base URL, or its own default endpoint (`https://api.deepseek.com`, `https://api.minimax.io/v1`, `https://api.anthropic.com`, …; trailing slashes and the host's case aside). With no base URL, the endpoint is its `*_BASE_URL`, else that default.
- With no key and any other base URL, the client refuses before any request. PenguinHarness shows the refusal as "Model `<id>` has no API key for `<URL>`", with the client's `*_API_KEY` / `*_BASE_URL` and both fixes: put the key in the file, or clear the base URL and set the variables. A model on the `mmsp` client with a base URL is still sent no key: an open MMSP server.
- To use a vendor variable on a vendor's second host (open.bigmodel.cn, api.moonshot.ai, api.minimaxi.com), a proxy or Bedrock, leave the base URL empty and set the vendor's `*_BASE_URL` beside the key.

## What follows the rule

- A new Project writes no table for the seven first-party groups, so their keyless models read the vendor's variable; a group or model that names the vendor's default endpoint reads it too. The gateways' tables carry their base URL, so their models need a key in the file.
- `GET /models`, the model dialog's hint, the group settings hint, the machine sync's report and `penguin config model list` ask MMSP's credentials module which variable a model reads, so they name exactly what a Session's client reads. The dialog's note that requests go to the client's default endpoint or its `*_BASE_URL` appears only for a model with no base URL anywhere.
- A custom, vLLM or user-created model with no base URL anywhere reads its protocol client's pair, `OPENAI_*` for the OpenAI-compatible protocols. The models page shows that variable when it is set.
- Protocol detection authenticates each probe with the variable its protocol's client reads, only at that client's default endpoint. The add-group endpoint listing passes the key and URL to MMSP as given.
- The DeepSeek balance uses `DEEPSEEK_API_KEY` while the group has no group key and no base URL other than `https://api.deepseek.com`. No gateway is lent a variable for its balance.
- Session creation and resume build the model's client before the Workspace or the Trace exists, so MMSP's refusal surfaces as `model_credential_missing` at creation.
- The harness's rows for the earlier client-type names `gemini-official` and `gemini-generate-content` were removed: MMSP's credentials module resolves them, so a Project that stores one keeps working, with the same variable, path and fast tier, until the MMSP release that drops the alias ([0.2.15 entry](../0.2.15/2026-10-10-backward-compatibility.md)).

## Penguin Go and ModelScope

Both take their key from the group's connection only. `PENGUIN_GO_API_KEY` and `PENGUIN_GO_BASE_URL` are no longer read by Sessions, probes, protocol detection or the balance query. A keyless Penguin Go model is sent to its relay without a key. The terminal still strips the two names from its environment.

## SDK

- `resolveEntryCredential(entry, group, override?)` returns the file's key, base URL and client type, verbatim, and throws nothing. MMSP's refusal surfaces when the client is built, as `ModelCredentialError`.
- `effectiveConnection` reports `apiKeySource` as `"model"`, `"provider"` or `"none"`; a model with no key in the file is `"none"`, whatever MMSP does with it.
- `listEndpointModels` passes the caller's key and base URL to MMSP as given.
- The catalog's `modelEnvironment(entry, group)`, `modelEnvPreviewKey(entry, group)`, `providerEnvFallbackKey(providerId, group)` and `clientEnvKey(clientType, baseUrl)` name the variables through MMSP's `environmentCredential`. `routedClientType` is MMSP's, re-exported, and returns `null` where nothing routes. `CLIENT_PROTOCOLS` holds each client type's request path and fast-mode protocol, and `vendorClientType` names a first-party group's official client.
- Removed: `resolveModelCredential`, `modelEnvFallback`, `resolveProviderModelEnv`, `endpointEnvApiKey`, `resolveModelEnv`, `VENDOR_ENDPOINTS`, `MMSP_CLIENTS` and `keylessEndpoint`. `ProviderConnection` has no `official` field, and none ever shipped.
- `@prismshadow/penguin-core/model-connection` is a browser-safe subpath with the connection rules alone: `effectiveConnection`, `groupKeyReaches`, `resolveEntryCredential`, `providerConnectionShape`, `canonicalClientType`, `sameClientType` and `sameEndpoint`. The root export still carries them.

## Compatibility

- A keyless model whose base URL is a vendor's second official host (`https://open.bigmodel.cn/api/paas/v4`, `https://api.moonshot.ai/v1`, `https://api.minimaxi.com/v1`) is refused instead of using `ZAI_API_KEY`, `MOONSHOT_API_KEY` or `MINIMAX_API_KEY`. Put the key on the model or its group, or clear the base URL and set the vendor's `*_BASE_URL` to that host beside the key.
- If you set only `PENGUIN_GO_API_KEY`, reconnect Penguin Go from its group header, or paste the key into its group settings.
- SDK callers of the removed functions use `resolveEntryCredential` or `effectiveConnection`, and the catalog's `modelEnvironment` for the variable names. Code that compared `routedClientType(...)` with `undefined` compares with `null`, and code that read `apiKeySource === "env"` from `effectiveConnection` asks `modelEnvPreviewKey`.
