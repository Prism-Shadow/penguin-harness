# Discover Copilot models without endpoint metadata

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `model-catalog`, `web`, `docs`
- **PR:** [#5](https://github.com/nicolaepocroianu/penguin-harness/pull/5)

[中文版](2026-09-19-copilot-model-discovery.zh.md)

Updated the development AgentHub patch to retain tool-capable chat models when Copilot omitted optional endpoint metadata.

## Details

- Kept explicit endpoint restrictions authoritative and excluded non-chat entries from the fallback.
- Preserved Penguin's model connection test for checking inference availability after import.
