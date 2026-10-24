# Blank API key and base URL fields say "Leave blank to use the default"

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[中文版](2026-10-24-model-field-placeholders.zh.md)

The model dialogs and the group settings stopped naming the endpoint or the environment variable in a blank field. A blank base URL that no group setting fills reads "Leave blank to use the default base URL" (zh: 「留空使用默认 base URL」). It used to read "Not set: requests go to https://api.deepseek.com by default" or "Not set: the client's default endpoint". An API key that a detected environment variable covers reads "Leave blank to use the default API key" (zh: 「留空使用默认 API key」). It used to name the variable.

## Details

- Where a Custom or user-created group requires a base URL, the group settings' field shows `https://…`, as the model dialog already did.
- These are unchanged: "Leave blank to use the group's setting", "Leave empty to keep the current key", the note on a group key that does not reach the model, the note under the key field that names where requests go, and the masked environment key.
- The catalog's `providerDefaultBaseUrl` was removed. It was added for the old placeholder in [vLLM reads its own variables](2026-10-22-vllm-local-default.md).
- The Models docs page quotes the new wording.
