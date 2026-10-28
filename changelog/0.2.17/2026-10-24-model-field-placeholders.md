# Blank base URL, API key and price fields say what a blank field does

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[中文版](2026-10-24-model-field-placeholders.zh.md)

The model dialogs and the group settings reworded the placeholder of a blank base URL field. Where no group setting fills it, the placeholder reads "Leave blank to use the default base URL" (zh: 「留空使用默认 base URL」). It used to read "Not set: the client's default endpoint".

An API key field is never left blank any more. Where nothing covers a blank key, it reads "Enter an API key" (zh: 「请填写 API key」). That means no stored key, no group key that reaches the model, and no environment variable the server reports set. Before, such a field had no placeholder, for example DeepSeek on a server without `DEEPSEEK_API_KEY`. Where the model's client calls its endpoint without a key, it reads "Leave blank to use no API key" (zh: 「留空则不使用 API key」) instead. That covers a vLLM server, which is sent vLLM's placeholder key `EMPTY`, and a self-hosted MMSP server, but not Penguin Go's relay. The catalog's `providerCalledKeyless` and `modelCalledKeyless` decide this from MMSP's credentials table.

The model dialog's three price fields read "Empty = not costed" (zh: 「留空则不计算费用」). A model saved without prices is left out of every cost.

## Details

- Every required base URL field on the Models page reads "Enter a base URL" (zh: 「请填写 base URL」) while empty. That covers three places: the group settings of a Custom or user-created group that has a model without a base URL of its own, the model dialogs of a model whose group sets none, and the Add group dialog's import. Each field shows the stored value where there is one. A blank one cannot be saved, and "A base URL is required" appears under the field. In the group settings and model dialogs, Save stays disabled. In the import, Detect and Import stay disabled. Before, the model dialogs and the import showed `https://…` in an empty required field, and the group settings showed the "Not set" text.
- The other API key placeholders are unchanged, and so is their order: "Leave empty to keep the current key", then "Leave blank to use the group's setting", then "Leave empty to use the DEEPSEEK_API_KEY env var" where the server reports the variable set, then the note on a group key that does not reach the model.
- The Models docs page quotes the new wording.
