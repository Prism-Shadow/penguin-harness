# A keyless model entry borrows an environment variable only for the vendor's own endpoint

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#794](https://github.com/Prism-Shadow/penguin-harness/pull/794)
- **Breaking:** yes — a model entry with no `api_key` whose `base_url` is not the vendor's own official endpoint (every gateway preset — TokenDance, OpenRouter, Fireworks AI, SiliconFlow, Qwen Pay-As-You-Go, Qwen Token Plan; `custom`, `vllm` and user-created rows with their own endpoint; a vendor row re-pointed at a proxy or at `bedrock://`) no longer reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (or any vendor variable) from the server environment; Sessions, the connection test, the group speed test, the vision probe, protocol detection and the endpoint listing refuse it instead

[中文版](2026-09-18-gateway-no-env-keys.zh.md)

AgentHub's clients read a vendor's environment variable whenever they are handed no key, whatever
base URL they were pointed at. A keyless row in a gateway group therefore sent the user's own OpenAI
or Anthropic key to the gateway: one group speed test on a mixed-protocol gateway made 27 requests,
7 carrying the Anthropic key and 20 the OpenAI key, and the model dialog's key field, once any
Anthropic row had shown the variable was set, told a gateway row to "leave empty to use the
ANTHROPIC_API_KEY env var". PenguinHarness now decides itself whether a keyless entry may lean on
the environment, before any client exists, and the rule is about the **destination**, not the
group's name: environment keys are for official endpoints only.

## Details

- Core's `modelEnvFallback` is the one rule; every client the harness builds applies it —
  Session creation and resume, the vision describer, the connectivity and speed probes, the
  vision probe and the utility completion through `resolveModelCredential`, the endpoint
  listing and protocol detection (a protocol and a URL, no entry yet) through
  `endpointEnvApiKey`. A keyless entry is allowed the routed client's variable when it has no base URL (the
  client's default endpoint is the vendor's own, or the `*_BASE_URL` the user set beside the key),
  or when its base URL is one of that vendor's own official endpoints (the catalog pins the
  DeepSeek and MiniMax rows this way). Anything else is refused with "Model
  `<provider>/<id>` has no API key … set the API key on the model entry", which the server files
  under `model_credential_missing` like the SDKs' own missing-credential errors.
- Where the fallback is allowed the client is still handed no key and reads the variable itself,
  exactly as before — a vendor row loses nothing, including a Bedrock `ANTHROPIC_BASE_URL` with no
  `ANTHROPIC_API_KEY`. The Penguin Go relay's provider-scoped `PENGUIN_GO_API_KEY`, which no
  AgentHub client knows, is read by the harness and passed explicitly for every row of that group;
  unset, the row is refused rather than left to the client's vendor variable. That closes the same
  hole for Sessions on keyless relay rows, which the probes had already guarded.
- The models API reports `envKey` only for entries the rule allows a fallback, and the masked
  `envKeyMasked` preview only where the fallback may be presented as covering the entry (core's
  `modelEnvPreviewKey`: a row whose own base URL is a vendor endpoint, or a keyless row in a
  vendor group or Penguin Go) — the eight vLLM presets and a custom row saved without a base URL
  do fall back, but are no longer shown as "key configured", which would have put a self-hosted
  model id in front of api.openai.com. The dialog's hint reads the same function, from the row as
  drafted — group, id, protocol and base URL — and hides the stored mask once the draft resolves
  to another variable; the group-level "Set key" dialog names a variable only for vendor groups
  and Penguin Go; the import dialog's key field says the endpoint's key is required.
- Two leaks one layer down are **not** fixed here and are tracked as an AgentHub follow-up (they
  reach the harness through the next AgentHub release and bump): the DeepSeek, GLM and Kimi
  clients hand the OpenAI SDK an undefined key when their own variable is unset, and the SDK
  fills it from `OPENAI_API_KEY`; and the Anthropic client lets its SDK attach the environment's
  `ANTHROPIC_AUTH_TOKEN` (and, on Bedrock, `ANTHROPIC_API_KEY`) even beside a row's own key.
- The `agent-development` plugin's `penguin-sdk` skill states the rule (plugin `2026.09.18.1`).
- Protocol detection and the add-group listing lend a bare endpoint the protocol's variable on
  the same terms: the vendor's own URL only. A gateway or a private
  server is probed anonymously (a protocol-shaped 401 still identifies the route), and a listing
  with no usable key is refused before a client exists.
- The `custom` group's Atria Dawn Preview preset, which used to read `ANTHROPIC_API_KEY`, now
  needs its own key like every other custom row.

## Compatibility

What stops working: a Session, connection test, speed test, vision probe, protocol detection or
model import on an entry that has no `api_key` and points anywhere other than the vendor's own
endpoint — every gateway group row, every `custom`, `vllm` or user-created row with its own base URL,
and a vendor row re-pointed at a proxy — now fails with "has no API key" where it used to run on
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` from the server environment. A self-hosted
server that accepts any bearer token is affected too: `OPENAI_API_KEY=dummy` in the environment no
longer covers it. A keyless Anthropic row with `base_url = "bedrock://<region>"` (AWS credential
chain) is refused as well, with a message that says so: until AgentHub stops letting its Bedrock
client attach `ANTHROPIC_API_KEY`, either set the entry's AWS key (`access,secret`) or leave the
row's base URL empty and export `ANTHROPIC_BASE_URL=bedrock://<region>` instead — a row with no base
URL still follows AgentHub's own pairing.

What to do: put the key on the row — **Model settings → API key**, the group header's **Set key**,
or `penguin config model add … --api-key <key>`. A self-hosted or custom server that used to run on
`OPENAI_API_KEY` + `OPENAI_BASE_URL` in the environment while the row carried its own base URL is
exactly this case: environment keys are for official endpoints only, so that key goes on the row.
A row with **no** base URL is untouched and still follows AgentHub's own env pairing (`*_API_KEY`
with `*_BASE_URL`). Nothing on disk changes shape and no migration runs; entries that already carry
a key are untouched.

There is no compatibility code, so there is no `backward-compatibility` entry for this batch.
