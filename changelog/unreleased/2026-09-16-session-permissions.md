# Each Session keeps its own permissions, and the composer shows how much they allow

- **Date:** 2026-09-16
- **Type:** feat
- **Scope:** core, server, web
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[中文](2026-09-16-session-permissions.zh.md)

The sandbox policy belongs to a Session now. A Session takes the server's Sandbox settings when it is created and keeps them, so changing those settings no longer reaches an agent that is already running. The composer's approval control becomes a permission button that shows the level at a glance.

- **The permission button** is an icon-only square, like the + button beside it, and the skills button now matches them: no text, no caret. The three sit as one tight cluster. It shows lucide's shield icon for the level, a different icon per level so the level never depends on colour alone. Red `shield-alert` is full access: full filesystem, network open, every call approved. Amber `shield-half` is partial: some write permission with something still holding it back. Green `shield-check` is read-only: commands cannot write. Grey `shield-off` is off: every tool call is denied. The accessible name and the tooltip spell out the level and all three settings.
- **A change of level is shown at once and animated.** The picked level shows immediately instead of after the save, and the button no longer dims while it saves, which together read as a flicker. The new icon turns and grows in; a refused save swaps back, with a toast saying why.
- **The menu has three sections.** Filesystem picks read-only, workspace write, or full access. Network allows or cuts off. Approval picks one of the four approval modes. For an administrator, a plain More… row opens the Settings page's Plugins tab scrolled to the Sandbox card. The draft page shows the same button, starting from the server's Sandbox settings, and the subagent panel edits its root Session's values.
- **Settings are defaults now.** The Sandbox card on the Settings page says so. A policy change on a Session applies from that Session's next command. A subagent runs under its root Session's policy, a fork and a model switch carry the policy over, and a handoff to another Agent carries it too.
- **An administrator's sandbox is still a ceiling for everyone else.** A non-admin may tighten a Session's policy but never pick a filesystem mode or network looser than the server's settings; the API answers `403 sandbox_forbidden`.
- **API.** `SessionInfo.sandbox` reports `{ mode, network }`. Session creation and `PATCH /api/sessions/:id` accept `sandbox`. `GET /api/projects/:p/chat-defaults` also serves the policy a new Session would start with. On the plugin side, `CreateAgentOptions.confineSpawn` is evaluated with the Session's coordinates, like `controlEnv`, and the sandbox service gains `confinerFor`.
- **Known gap:** Filesystem and Network confine commands only. The file-writing tools are still governed by the approval mode alone, as before.

Existing Sessions are handled as described in [backward compatibility](2026-09-16-backward-compatibility.md).
