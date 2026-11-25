# The machines domain joins the library packages

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/machine`, `library/http`, `packages/cli`

[中文版](2026-11-24-library-machines.zh.md)

The machines domain moves beside the vocabulary packages that landed before it. `@prismshadow/penguin-library-machine` takes the ssh fleet's transport, the install and connect jobs, the machines service, the machines routes, the machines page's wire vocabulary, the machine-status reader, the stored-ssh-password helper and the carried-store lay-down. `@prismshadow/penguin-library-http` takes the shared heartbeat interval and the API socket's per-message-deflate setting.

The server imports these; nothing in the library imports the server. The machines service keeps its server-side assembly: the Provider Module stays, the service class moves. The API's export surface stays whole through re-exports — the server's `machines/…` import paths, `@prismshadow/penguin-server/machine-status` and `@prismshadow/penguin-server/secret-file` still resolve — and the CLI and everything else imports the library packages directly.

## Details

- `library/machine` grows: the machines service, its effects and effects, the route factories (machines routes, the machines server-proxy routes, the session forward, the machines' history reads), the aggregate event stream, the socket dialler, the ssh transport (its own `transport/` modules), the install, upgrade, checkout-image and shipped-image machinery, the models/plugins/settings sync jobs, the diagnosis and probe helpers, the machine-status reader, and the domain's wire vocabulary (`contract`, `ports`).
- `library/http` grows: `heartbeat` (the one interval every stream beats at) and `socket-compression` (the API socket's deflate setting), each re-exported from the server module it used to live in.
- The machines service's pushed-build effects are bound in the server's assembly, where the server's own push seam lives; the machines-facing adoption and leave-out header literals are named in the domain's contract.
- Every interface class involved declares its members under the `@Interface` decorator.
