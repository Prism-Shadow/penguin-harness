# Compatibility with existing installations

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `server`, `cli`, `web`
- **PR:** [#1795](https://github.com/Prism-Shadow/penguin-harness/pull/1795), [#1823](https://github.com/Prism-Shadow/penguin-harness/pull/1823), [#1825](https://github.com/Prism-Shadow/penguin-harness/pull/1825)

[中文版](2026-11-24-backward-compatibility.zh.md)

## Existing company tickets

A ticket filed as `2026-09-02-launch-the-site` keeps that exact ID and Markdown filename. Existing board bookmarks, parent and blocker links, channel references and Sessions continue to use the recorded ID. New and existing tickets can reference each other. No migration or user action is required.

The server and clients keep reading date-first IDs for as long as existing files and external references use them. Maintainers can retire this support only through a separately agreed migration that covers those references.

## Existing traces

The activity header reads existing conversations directly. When a thinking block or tool call has no recorded starting fragment, its generation time is unknown. A recorded tool execution still contributes its measured time. No migration or user action is required. The optional start time must remain supported while clients can open traces that omit it.

## First-workbench guide bookmarks and progress

Existing guide bookmarks reopen the guide in chat for the same agent and machine. The guide reads the progress already saved in the current tab. Checklist workbenches and their contents stay on the agent. No migration is required. Maintainers can retire the bookmark and tab-storage handling only after a separate decision to end support for those links and saved sessions.
