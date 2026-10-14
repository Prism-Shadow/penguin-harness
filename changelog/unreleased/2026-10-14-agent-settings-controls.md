# Localized Agent settings and tool deletion

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)

[中文版](2026-10-14-agent-settings-controls.zh.md)

Replaced configuration-key labels in Agent runtime and tool settings with localized names, including System prompt, Thinking level and Access permissions. Reused the new-conversation thinking menu in runtime and API settings, showing the concrete effective default without saving an override. Placed API concurrency and approval controls on the same row when space permits.

## Delete tools

Added a confirmed delete action to each built-in tool. Deletion saves immediately, preserves other unsaved parameters and prevents the tool from being exposed or executed in newly assembled contexts. The confirmation states when existing conversations adopt the change. Removing the last tool preserves an empty toolset.
