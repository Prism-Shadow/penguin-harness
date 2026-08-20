# Installed workflows, registered through the extension seam

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-08-20-installed-workflows.zh.md)

A workflow can be installed into a running harness over HTTP and called on the next
request, with no push and no restart. An installed workflow is a named unit with a `run`
function, stored in the agent's own folder and registered into the App's workflow set —
the same set an extension registers into, so both are one thing to everything downstream.

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

The script body returns `{ name, version, run }`, optionally `setup` and `park`. It is
evaluated once at install time, so a script that cannot satisfy the contract is refused to
the installer rather than surfacing at some later boot, and the installation is rolled back
off disk.

- `setup(ctx)` registers tools. A tool is `{ name, description, run }`, validated on
  registration, owned by the workflow that offered it, and withdrawn when that workflow
  goes. A name another workflow owns is refused, never shadowed.
- `run(input, ctx)` receives a run context whose `runAgent(prompt)` drives an agent. The
  seam is in place; production leaves it unconfigured for now, and a workflow that calls
  it is told so rather than failing obscurely.
- `park()` returns the state the next instance resumes from, written down as the workflow
  is unregistered.

## When a workflow is live

A workflow belongs to an agent and is registered only while that agent is active: its
tools join the tool set as the agent's first session opens and leave as its last one
closes, with `park()` written to disk on the way out. Activation is refcounted, so several
sessions can hold the same agent open. An agent nobody is talking to contributes nothing.

Installing for an active agent registers it immediately; installing for an idle one stores
it to wait for the next activation.

## What survives a push

The script and its state live under `<agent>/agent_state/workflows/<workflowId>/`, outside
the platform bundle, so a push never touches them. Which agents were live is parked in the
platform document alongside terminal handle ids, and the new App re-registers exactly
those — without it a push would leave the tool set empty while the installations look
intact. A ref whose script is gone or no longer valid is reported and skipped, and the
rest still load. Nothing enumerates agents.

## In the Web App

A workflow that ships a UI appears as its own tab beside Chat, keyed by the content hash
of its UI tree so an open tab notices a reinstall. Chat is always reachable: a tab whose
workflow disappears falls back to it.
