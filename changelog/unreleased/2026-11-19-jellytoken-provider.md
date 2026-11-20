# JellyToken model group

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`

[中文版](2026-11-19-jellytoken-provider.zh.md)

Added nine JellyToken chat presets with a shared group key. New Projects received the presets; owners of existing Projects could add them with **Add new models** without changing their default model.

## Details

- The group used Chat Completions at `https://aiservice.jellytoken.com/v1`. Its key-management, model-list and model-ID links opened `https://www.jellytoken.com/models?utm_source=penguin-harness`.
- The presets used a 1M-token context setting. Their starting-offer labels did not change the rates used by the cost center.
