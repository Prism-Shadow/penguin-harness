# Model page refinements: draft follows the new default, ordered dropdown, GPT vision, homepage links

Four refinements: changing the Project's default model now resets the stored draft's model
selection to follow the new default; the chat model dropdown lists models in the same order
as the model library page; all GPT models are marked vision-capable; and model cards link to
each model's homepage.

## Details

- Draft follows the default: when saving a default-model change on the Models page, the
  current user's stored draft for that Project drops its `modelRef` — the draft chat then
  resolves the (new) default live instead of pinning the old model forever.
- Dropdown order: a new `orderModelsLikeLibrary` helper (unit-tested) flattens the library
  grouping — built-in provider groups in MODEL_PROVIDERS order, user-defined groups after,
  custom last, in-group order preserved — and the chat model dropdown now uses it.
- GPT vision: `openai/gpt-5.6-sol` and `openai/gpt-5.6-terra` are flipped to
  vision-capable — GPT models are uniformly multimodal (OpenAI product-line policy) even
  where the gateway page omits the modality.
- Homepage links: a new `modelHomepageUrl` helper (unit-tested) — OpenRouter and Qwen Token
  Plan have stable per-model URL patterns (working for user-added ids in those groups too;
  the unpaged Token Plan preview model falls back to the plan overview), direct vendors link
  to their model docs page, custom/user-defined groups have none. Model cards show the link
  as a corner external-link icon (a sibling of the clickable card, since interactive
  elements must not nest).
