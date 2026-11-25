# The session domain's services join the session library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/session`, `library/trace`, `library/agent`, `library/messaging`

[中文版](2026-11-24-library-session-services.zh.md)

The server's session index service, session deletion and archive-page service move beside the session vocabulary package that landed before them. `@prismshadow/penguin-library-session` takes the session index service (the DB-backed list, the create path and the startup adoption sweep), the session deletion walk and the archive-page service with its DTOs, together with the pieces they speak at runtime: the Session listing rule, the session_id timestamp, the trace shard path builder, the system Agent's session refusal, the sandbox ceiling comparison and the workspace-group helpers. The `SessionInfo` view and the chat-channel names move with the contract.

The server imports these; nothing in the library imports the server. The services keep the server-side assembly where the server's own mechanisms are bound: the session runtime, the Project config store, the trace index and store, and the notifier satisfy structural ports the package declares (`SessionRuntimes`, `SessionDefaultModel`, plus the trace interfaces), and the services keep taking them as constructor deps. The API's export surface stays whole through re-exports — `@prismshadow/penguin-server/api` and the in-repo forwards still in use keep the old import paths resolving.

## Details

- `library/session` grows: `session-service`, `session-deletion`, `archived-sessions-service` (with the archive page's query and response shapes), and the ports module (`SessionRuntimes`, `SessionDefaultModel`, the session lifecycle events the services publish, and the archive page's narrowed Project view). The package index now exports `SessionInfo` and `MessagingChannel`.
- The session vocabulary the services speak at runtime moves into the package: the listing rule and source view (`listing`, re-exported by `library/trace/listing`), the `session_id` timestamp (`session-id`, re-exported by `library/trace/session-id`), the trace shard path builder (`trace-file-path`, re-exported by `library/trace/trace-index`), the system Agent's refusal at the session create path (`system-agent`, re-exported by `library/agent/system-agent`), the sandbox ceiling (`sandbox-ceiling`) and the workspace groups (`workspace-group`).
- `library/trace` keeps its `SessionCategory` and per-category counts where they are; the session package reads them as types.
- `library/messaging` re-exports the chat-channel names from the session contract (the definition moved with `SessionInfo`); every import path is unchanged.

## Compatibility

This batch changes no behavior: the moved code is the same code at a new address. The existing subpaths — `@prismshadow/penguin-server/api` and the in-repo forwards (`services/session-service.ts`, `services/session-deletion.ts`, `services/archived-sessions-service.ts`, `services/workspace-group.ts`, `services/sandbox-ceiling.ts`, `services/system-agent.ts`) — still export the moved names (re-exported from the library packages); change imports to the library packages when you touch those files next.
