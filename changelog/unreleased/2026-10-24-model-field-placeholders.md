# A blank base URL field says "Leave blank to use the default base URL"

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[中文版](2026-10-24-model-field-placeholders.zh.md)

The model dialogs and the group settings stopped naming the endpoint in a blank base URL field. Where no group setting fills it, the placeholder reads "Leave blank to use the default base URL" (zh: 「留空使用默认 base URL」). It used to read "Not set: requests go to https://api.deepseek.com by default" or "Not set: the client's default endpoint".

## Details

- A required base URL field has no placeholder. This covers the group settings of a Custom or user-created group that has a model without a base URL of its own, and the model dialogs of a model whose group sets none. The field shows the stored value, and a blank one cannot be saved: Save stays disabled and "A base URL is required" appears under the field. Before, the model dialogs showed `https://…` in an empty required field, and the group settings showed the "Not set" text.
- The API key placeholders are unchanged, including the one that names the environment variable a blank key uses.
- The catalog's `providerDefaultBaseUrl` was removed. It was added for the old placeholder in [vLLM reads its own variables](2026-10-22-vllm-local-default.md).
- The Models docs page quotes the new wording.
