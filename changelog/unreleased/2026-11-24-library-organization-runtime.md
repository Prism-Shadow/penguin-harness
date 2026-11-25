# The organization domain's runtime joins the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/organization`, `library/agent`, `core`

[中文版](2026-11-24-library-organization-runtime.zh.md)

The organization domain's files, runtime and contract move beside the vocabulary packages that landed before them. `@prismshadow/penguin-library-organization` takes the organization's file vocabulary (the org config, chart, ticket, channel and handbook readers and writers), the runtime service with its scheduler, reconcile passes and triggers, the deletion flow that removes an organization with its employees' Agents, and the route factory behind `/api/projects/:projectId/organizations`; the organization's API DTOs move with them, and the Agent-deletion DTOs join `@prismshadow/penguin-library-agent`. The semantic id pattern a creator-typed id answers joins `@prismshadow/penguin-core`.

The server imports these; nothing in the library imports the server. A moved service keeps its server-side assembly where it binds a server capability: the module that binds the runtime's deps seam, the routes' module node and the Agent-deletion steps stay, and the service names what it needs through the deps port. The API's export surface stays whole through re-exports — the in-repo forwards still in use keep the old import paths resolving — and everything else imports the library packages directly.

## Details

- `library/organization` grows: the org file vocabulary (`org_config.toml`, `org_chart.yaml`, tickets, channels, the handbook, paths, principals, ticket ids, timezone arithmetic), the runtime service and its scheduler, reconcile, model, notices, budget, digest, locks and triggers, the `OrgRuns`/`OrgSessions`/`OrgScheduler`/`OrgService` contracts, the organization-deletion flow, the organization route factory, and the company mode's API DTOs.
- `library/agent` grows: the Agent-deletion DTOs (`AgentDeletionInfo` and the delete answers).
- `core` grows: the semantic id pattern (`SEMANTIC_ID_PATTERN`) beside the id rule.
- Every interface class involved declares its members under the `@Interface` decorator.
