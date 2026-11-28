# The auth domain joins the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/auth`, `library/agent-api`, `core`

[中文版](2026-11-24-library-auth.zh.md)

The auth domain's service and its vocabulary move beside the contract package that landed before them. `@prismshadow/penguin-library-auth` takes the auth service (admin seeding, login, logout, password change, session validation), the password hashing vocabulary, the auth middleware and its cookie and origin checks, the local API token's file rule, the process-scoped auth runtime state, the live-stream registry, the offline `reset-admin-password` rescue, the first-login notice renderer, and the CLI token minting that writes a session row straight into `web.db`. The Agent API's public path prefix joins `@prismshadow/penguin-library-agent-api`, and the session cookie's name moves with the middleware.

The server imports these; nothing in the library imports the server. The service keeps its server-side assembly: the Provider binds the service's ports (the users and auth-sessions repos, the process-scoped state, the config and clock capabilities, the password hasher, the initial-Project provisioner) to the server's own mechanisms. The API's export surface stays whole through re-exports — the in-repo forwards still in use keep the old import paths resolving, and the server package's exported subpaths keep their spelling.

## Details

- `library/auth` grows: `service` (with the `AuthConfig`/`AuthClock` ports and the `InitialProjectProvisioner` contract), `password`, `middleware` (the session cookie's name and the `OwnOrigin` type beside the factories), `api-token`, `runtime-state`, `require-human`, `live-streams`, `auth-token`, `initial-password`, `reset-admin-password`.
- `library/agent-api` grows: the public group's path prefix (`AMSP_PREFIX`).
- Every interface class involved declares its members under the `@Interface` decorator.
