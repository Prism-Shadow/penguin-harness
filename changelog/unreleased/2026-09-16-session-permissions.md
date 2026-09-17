# Each Session keeps its own permissions, and the composer shows how much they allow

- **Date:** 2026-09-16
- **Type:** feat
- **Scope:** core, server, web
- **PR:** [#767](https://github.com/Prism-Shadow/penguin-harness/pull/767)

[中文](2026-09-16-session-permissions.zh.md)

The sandbox policy belongs to a Session now. A Session takes the server's Sandbox settings when it is created and keeps them, so changing those settings no longer reaches an agent that is already running. The composer's approval control becomes a permission button that shows the level at a glance.

- **The permission button** wears a shield coloured by level, with a different mark inside it per level, so the level never depends on colour alone: an exclamation for full access, a split for partial, a check for read-only, a strike for off. Red is full access: full filesystem, network open, every call approved. Amber is partial: some write permission with something still holding it back. Green is read-only: commands cannot write. Grey is off: every tool call is denied. The level's name sits beside the shield when the card is wide enough, and the tooltip lists all three settings.
- **The menu has three sections.** Filesystem picks read-only, workspace write, or full access. Network allows or cuts off. Approval picks one of the four approval modes. For an administrator, More… opens the Settings page's Plugins tab scrolled to the Sandbox card. The draft page shows the same button, starting from the server's Sandbox settings, and the subagent panel edits its root Session's values.
- **Settings are defaults now.** The Sandbox card on the Settings page says so. A policy change on a Session applies from that Session's next command. A subagent runs under its root Session's policy, a fork and a model switch carry the policy over, and a handoff to another Agent carries it too.
- **An administrator's sandbox is still a ceiling for everyone else.** A non-admin may tighten a Session's policy but never pick a filesystem mode or network looser than the server's settings; the API answers `403 sandbox_forbidden`.
- **API.** `SessionInfo.sandbox` reports `{ mode, network }`. Session creation and `PATCH /api/sessions/:id` accept `sandbox`. `GET /api/projects/:p/chat-defaults` also serves the policy a new Session would start with. On the plugin side, `CreateAgentOptions.confineSpawn` is evaluated with the Session's coordinates, like `controlEnv`, and the sandbox service gains `confinerFor`.
- **Known gap:** Filesystem and Network confine commands only. The file-writing tools are still governed by the approval mode alone, as before.

Existing Sessions are handled as described in [backward compatibility](2026-09-16-backward-compatibility.md).
