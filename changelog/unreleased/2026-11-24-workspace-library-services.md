# The workspace domain's session-list, draft and directory-skill services move into the workspace library

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/workspace`

[中文版](2026-11-24-workspace-library-services.zh.md)

The workspace domain's remaining services join the workspace library (`@prismshadow/penguin-library-workspace`): the session list's workspace groups (the temp-workspace sentinel and the path rules that fold auto-created directories into it), workspace path validation, archiving a whole workspace group, the account's drafts vocabulary with its patch parsing, the draft screen's shortcut bounds, and the skills discovered in a user-picked directory. Each moved module keeps a pure re-export at its old server path, so the server's import paths are unchanged, and the drafts vocabulary (`DRAFT_KINDS`, the draft value caps, `DraftShortcut`) is re-exported from the server's `./api` types as before.

The library stays server-free. The archive service speaks structured ports — the Session index, the active-row reader and the Project event notifier it reaches — and its cross-domain types arrive as type-only imports, so the workspace package's manifest gains no new dependencies.

## Compatibility

The public HTTP/SSE API is unchanged. The client-facing type entry points (`@prismshadow/penguin-server/api` and the other server subpaths) keep exporting the same names; the moved shapes are re-exported from where they used to live.
