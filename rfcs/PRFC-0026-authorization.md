# PRFC-0026 Authorization: Dual-Surface Permissions and Route-Level HTTP Grants

[中文版](PRFC-0026-authorization.zh.md)

- Feature Name: `authorization`
- Start Date: 2026-11-20
- PRFC PR: none yet (native to this repository)
- Implementation PR: —

## Summary
[summary]: #summary

This RFC defines the authorization model of the harness, splitting capability boundaries across two API surfaces: **CLI** and **HTTP**. The **CLI surface** executes locally in the caller's process with the current operating system environment (terminal, TTY, filesystem) as its permission core, representing **system permissions**, and obtains Penguin capabilities by calling the HTTP surface. The **HTTP surface** executes in the server process, enforcing **penguin permissions** through named route `id`s, user sessions, and Agent role sessions. Local access to the Penguin Home Root (`PENGUIN_HOME`) is equivalent to Penguin administrator authority (`Access to Penguin Home Root = penguin admin`).

## Motivation
[motivation]: #motivation

### Two surfaces guard two distinct trust boundaries

Terminal commands and server endpoints run in different contexts and draw authority from different sources. The CLI runs inside the caller's own process and working directory, governed by the operating system user, TTY, and filesystem namespace. The HTTP surface runs inside the server process, facing callers across processes or networks, and relies on credentials (the local `api-token`, human user sessions, and Agent session tokens) to identify the caller and bound what it may touch.

### Direct data-root mutation from the CLI bypasses HTTP authorization

When business commands read or write configuration files and databases directly inside the CLI process, the role and scope checks on the HTTP surface are bypassed. Routing all Penguin capabilities through the HTTP surface — leaving only a small set of system bootstrap and token-inspection commands to run locally — concentrates application authorization in a single enforcement point.

### Agent calls need credentials scoped by route ID

Agents with different responsibilities need different slices of the HTTP surface. A default conversational Agent manages scheduled tasks and its own workbench; an initialization or self-improvement Agent manages skills and plugins; an organization employee Agent calls organization collaboration endpoints. Issuing role-bound session tokens to each Agent and registering every HTTP route with a meaningful `id` allows the authorization layer to grant access by route `id` sets and project boundaries.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### Permission philosophy: CLI = system permissions, HTTP = penguin permissions

Two rules anchor permissions across the harness: **CLI = system permissions**, and **HTTP = penguin permissions**.

- The **CLI surface** runs locally with the current system environment (terminal, TTY, fs) as its permission core. Which local files it can read, which terminal stream it attaches to, and which local sockets it can reach are determined by the operating system permissions of the current process. Whenever the CLI performs Penguin operations (managing Agents, sessions, model configurations, vault secrets, schedules, plugins, or runtime version reports), it acts as an HTTP client of the server.
- The **HTTP surface** guards all Penguin capabilities. The server verifies the Bearer token on each request, resolves the caller's identity and role, and checks the target route's `id` and project scope before running the handler.

### Access to Penguin Home Root = penguin admin

Read access to the Penguin Home Root (`PENGUIN_HOME`) on the local filesystem is equivalent to holding `penguin admin` authority for that instance.

When the server starts, it writes `api-token` (mode `0600`) and `server.lock` inside the home root. Any local process that can read the home root can read `api-token` (for example via `penguin auth token`) to call the HTTP surface as an administrator, and can manage the local server lifecycle directly. Environments that must restrict a caller below administrator isolate the home root at the filesystem level.

### Example: dual-surface cooperation inside a Sandbox

An example of an Agent running commands inside a sandbox illustrates how the two surfaces work together:

1. **Provisioning the sandbox view and Agent token**: When the host spawns a tool subprocess inside a sandbox, it mounts a restricted filesystem view (the workspace and sandbox temp directories are accessible, while the host's Penguin Home Root is unmounted) and injects `PENGUIN_API_URL` along with the Agent's session token `PENGUIN_API_TOKEN` into the environment.
2. **Executing system operations from the sandbox perspective (CLI = system permissions)**: When the Agent invokes shell commands or the `penguin` CLI inside the sandbox, the CLI runs locally inside the sandboxed process and operates strictly within the sandbox's terminal and filesystem view.
3. **Acquiring Penguin capabilities over HTTP (HTTP = penguin permissions)**: When the CLI inside the sandbox calls the server, it authenticates with `PENGUIN_API_TOKEN`. The server verifies the Agent role and route `id` grant attached to that token, permitting only the endpoints granted to that role within the Agent's own project.

### Route ID registration and Agent role grants

Every HTTP route contributed to the `HttpModule.routes` slot carries a dotted `id` used to manage authorization:

```ts
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "penguin.session.list", method: "GET", prefix: "/api/projects/:projectId/sessions", auth: "user", order: 130 },
      { id: "penguin.session.create", method: "POST", prefix: "/api/projects/:projectId/sessions", auth: "user", order: 130 },
    ],
  },
})
```

A route component binds individual route contributions to handlers on its `Hono` router using `endpointOf(group, method, subPath)`. Each Agent session binds a role template (`AgentAuthRole`: `general`, `system-maintainer`, `admin`, `full-permissions`) and a current grant (`AgentAuthGrant`), specifying whether the session spans all endpoints (`allEndpoints`), whether it reaches Agent API and key settings (`agentApi`), and which explicit route `id`s (`apiIds`) are granted.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### HTTP route contribution shape and `endpointOf`

The data shape for the `HttpModule.routes` slot contains five fields:

- `id: string` — the unique identifier of the route, named by `<domain>.<resource>.<action>` (for example `penguin.agent.list`, `penguin.workspace.read`, `penguin.command.exec`, `penguin.config.providers.get`, `penguin.vault.set`).
- `method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"` — an optional single-method constraint. When present, the host mounts the handler only for that HTTP method and path; when omitted, the host mounts the sub-router for the prefix.
- `prefix: string` — the path pattern mounted on the HTTP application.
- `auth: "user" | "token" | "none"` — the authentication gate for the route (`"user"` accepts a human session, the local API token, or an authorized Agent session; `"token"` accepts only the local API token; `"none"` is public).
- `order: number` — the mount order on the HTTP application.

When a component defines several endpoints on one `Hono` group, `endpointOf(group, method, subPath)` builds a single-route `Hono` wrapper that preserves the group's middleware and error handler while dispatching only the declared method and path. This keeps related handlers in one component while giving every endpoint its own route `id` in the manifest.

### Agent role templates and permission scopes

Four fixed Agent role templates (`AgentAuthRole`) define the standing scopes:

| Role (`AgentAuthRole`) | `allEndpoints` | `agentApi` (passes `requireHuman`) | Endpoint and project scope |
| --- | --- | --- | --- |
| `general` (default) | `false` | `false` | Explicitly granted `apiIds` only, bounded to the Agent's own `:projectId` |
| `system-maintainer` | `false` | `true` | Explicitly granted `apiIds` + Agent API/key endpoints, bounded to the Agent's own `:projectId` |
| `admin` | `true` | `false` | All `auth: "user"` routes across projects, excluding `requireHuman` endpoints |
| `full-permissions` | `true` | `true` | All `auth: "user"` routes across projects, including `requireHuman` endpoints |

### Agent session storage and generation re-derivation

`AgentAuthService` and `AgentAuthSessionsRepo` manage Agent tokens and permission state through two database tables:

- `agent_auth_sessions`: stores the SHA-256 `token_hash`, `project_id`, `agent_id`, the `role` and `generation` at issuance, `created_at`, `expires_at`, and `last_used_at`. The raw token is returned only once by `issueSession`; only its hash is stored.
- `agent_auth_generations`: keyed by `(project_id, agent_id)`, tracks the current `generation`, the current `role`, and the explicitly granted route IDs `allowed_apis` (a JSON array read as `apiIds`).

When a request arrives with an Agent Bearer token, `AgentAuthService.authenticate` verifies that the session row exists and is unexpired, then reads the Agent's current row in `agent_auth_generations` to derive `AgentAuthGrant { role, generation, allEndpoints, apiIds }`. Updating an Agent's role or `apiIds` via `bumpGeneration` takes effect on the next request without re-issuing the token. Archiving or deleting an Agent calls `revokeAll(projectId, agentId)`, deleting both the session rows and the generation row.

### HTTP authentication and route-level authorization

Every protected request entering `HttpModule` passes through two checks:

1. **Authentication**:
   - A Bearer token matching the local API token or an active human user session authenticates with that human user's identity (`c.var.user`).
   - On `auth: "user"` routes, a Bearer token matching `AgentAuthService.authenticate(bearer, now)` populates `c.var.agentAuth` with `{ projectId, agentId, grant, agentApi }` and resolves the project owner (or admin fallback) as the request's user context (keeping `isAdmin` only when `grant.allEndpoints` is true).
2. **Route Authorization**:
   - Human user requests proceed under standard user and administrator checks.
   - Agent requests (`c.var.agentAuth` present) run `checkRouteAuth(c, route.id)` before the route handler:
     - Endpoint check: requires `grant.allEndpoints === true` or `grant.apiIds.includes(route.id)`, returning `403 permission_required` otherwise.
     - Project isolation check: when `grant.allEndpoints === false` and the route carries a `:projectId` parameter, `:projectId` must equal `agentAuth.projectId`, returning `403 permission_required` otherwise.
     - Human-only gate (`requireHuman`): permits Agent requests only when `agentAuth.agentApi === true` (`system-maintainer` or `full-permissions`), returning `403 human_required` otherwise.

### Boundary of the CLI surface

CLI commands fall into two categories by where they execute:

- **Local system commands**: interact directly with the local operating system and home root, comprising `penguin server` (start, stop, status, and reset-admin-password), `penguin web`, `penguin auth token` (reading the local `api-token`), and `penguin version` (printing the local build identity).
- **HTTP commands**: cover all remaining Penguin commands, including `penguin chat`, `penguin agent`, `penguin session`, `penguin send`, `penguin cost`, `penguin schedule`, `penguin org`, `penguin plugin`, `penguin exec`, `penguin config model`, `penguin config vault`, and `penguin version --json`. These commands resolve connection credentials through `resolveConnection` (preferring `PENGUIN_API_URL` and `PENGUIN_API_TOKEN`, then falling back to `server.lock`, `cli-session.json`, or `api-token` under `--root` or `PENGUIN_HOME`) and call the HTTP surface through `ServerClient`.

## Invariants
[invariants]: #invariants

### Penguin capabilities are authorized on the HTTP surface

> However a caller invokes Penguin — from the terminal CLI or from an external client — operations that read or mutate Penguin business state execute through the [HTTP surface](#guide-level-explanation) and are governed by the same route-level authorization rules.

The CLI holds the local process's system permissions, while the server guards Penguin state. Routing business operations through the HTTP surface ensures that user sessions and Agent role boundaries hold uniformly across every entry point.

### Home root access is administrator authority

> Wherever the harness runs, a process with local read access to the [Penguin Home Root](#guide-level-explanation) can obtain administrator credentials; any environment that restricts a caller below administrator must isolate the home root at the filesystem level.

The home root holds the instance's `api-token`, database, and secret files. Defining filesystem access to the home root as the system-level administrator boundary aligns local administration and sandbox isolation with native operating system file permissions.

### Every protected HTTP route is identified by a unique ID

> Whether contributed by a core module or by a plugin, every route registered on `HttpModule.routes` carries a unique [route `id`](#reference-level-explanation), and Agent role endpoint grants are evaluated against that `id`.

The route `id` decouples URL structure from authorization policy. When path parameters or mount prefixes evolve, role grants continue to reference endpoints by a stable identifier.

## Drawbacks
[drawbacks]: #drawbacks

Business CLI subcommands (including `penguin config model`, `penguin config vault`, and `penguin version --json`) require a reachable server process to fulfill requests. Splitting multi-action route groups into per-method, per-subpath contributions also increases the number of entries in the `HttpModule.routes` manifest.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**Splitting permissions by surface (CLI = system, HTTP = penguin)**: the operating system enforces process, TTY, and filesystem isolation, while the HTTP server enforces roles, route allowlists, and project isolation, each using its native primitives.

**Authorizing by route `id` instead of URL regular expressions**: route `id`s are projected into `ifaces.json` at build time, remain stable across path refactors, and can be enumerated statically.

**Generation counters plus session rows instead of stateless tokens**: `agent_auth_generations` in the database allows immediate revocation of all tokens belonging to an Agent when the Agent is deleted or its role changes, while preserving per-session revocation.

## Prior art
[prior-art]: #prior-art

**Docker CLI / Daemon and Kubernetes `kubectl` / `kube-apiserver`** use the same dual-surface split: the CLI runs in the caller's local system environment under local file permissions, all daemon and cluster state changes happen over an authenticated HTTP API, and local read access to the daemon socket or admin kubeconfig file is equivalent to administrator authority.

**AWS IAM Action IDs** use named `<service>:<action>` identifiers rather than raw URL paths as the unit of policy grants; route `id`s play the same role here.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- How HTTP routes contributed by third-party plugins declare which non-admin Agent roles may call them.
- Whether `apiIds` allowlists should support dotted prefix wildcards such as `penguin.session.*`.

## Future possibilities
[future-possibilities]: #future-possibilities

- Surfacing and editing each Agent role's route `id` allowlist in the administration UI, with per-project or per-Agent overrides.
- Issuing short-lived session tokens with an expiration timestamp and a narrower subset of route `id`s for sandboxed subtasks.

---

## Changes

### v1.0.0

- Initial version (draft, native to this repository).
