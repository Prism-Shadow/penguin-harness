# Compatibility with existing installations

- **Date:** 2026-11-24
- **Type:** change
- **Scope:** Company mode

[中文版](2026-11-24-backward-compatibility.zh.md)

## Existing company tickets

A ticket filed as `2026-09-02-launch-the-site` keeps that exact ID and Markdown filename. Existing board bookmarks, parent and blocker links, channel references and Sessions continue to use the recorded ID. New and existing tickets can reference each other. No migration or user action is required.

The server and clients keep reading date-first IDs for as long as existing files and external references use them. Maintainers can retire this support only through a separately agreed migration that covers those references.
