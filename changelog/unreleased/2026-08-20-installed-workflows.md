# Installed workflows, registered through the plugin seam

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`

[中文版](2026-08-20-installed-workflows.zh.md)

A workflow can be installed into a running harness over HTTP and called on the next
request, with no push and no restart. An installed workflow is a named unit with a `run`
function, stored in the agent's own folder and registered into the App's workflow set —
the same set a plugin registers into, so both are one thing to everything downstream.

## The surface

Served by the platform through the HTTP seam, so the whole surface ships and changes by
hot push rather than by rebuilding every installation.

- `GET /api/workflows` — what this App has registered
- `POST /api/workflows` — install or replace one, given `projectId`, `agentId`,
  `workflowId` and `script`, plus optional `ui` files as base64
- `DELETE /api/workflows/:projectId/:agentId/:workflowId` — uninstall
- `POST /api/workflows/:name/run` — call one by the name its script declares
- `GET /api/workflows/:projectId/:agentId/:workflowId/ui/*` — its own UI files

Every route requires an identified caller. A script runs in the server process with the
server's authority.

## The script contract

The script body returns `{ name, version, run }`. It is evaluated once at install time, so
a script that cannot satisfy the contract is refused to the installer rather than
surfacing at some later boot, and the installation is rolled back off disk.

`run` is called per request; the factory is re-run per App creation, so a script that keeps
state gets a fresh instance on every boot and a swap never carries a half-built one across.

## What survives a push

The script lives under `<agent>/agent_state/workflows/<workflowId>/`, outside the platform
bundle, so a push never touches it. Which installations an App carries is parked in the
platform document alongside terminal handle ids, and the next App reloads exactly those —
a ref whose script is gone or no longer valid is reported and skipped, and the rest still
load. Nothing enumerates agents.
