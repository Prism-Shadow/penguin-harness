---
title: Verify Agent roles, refiners, mismatch fallback, and permission upgrade requests end to end
starts_from: install/from-ref
inputs:
  handover: <RUN>/install/from-ref/handover.md
  model_credential: a model provider and key the run may use, or "local" to use the bundled local OpenAI-compatible driver
cost: 30
platforms: [linux, macos, windows]
---

## Goal

Verify that an Agent Session runs under its assigned `AgentRole` token rather than the server's admin credential, and that route permissions, `@self` / `@withAsk` refiners, role mismatch fallback, and the three permission upgrade modes (`allowed_once`, `allowed_for_agent`, `always_allowed`) bound the Agent's CLI and REST API actions end to end.

## Steps

Read `handover.md` first. Run every command with the `HOME` it names and the installed `penguin` CLI. Keep `oplog.md` from the first step and save full JSON responses and command outputs under `evidence/`. For mechanical verification across all turns, you may also run `node tests/scenarios/usability/agent-auth/scripts/verify-agent-auth.mjs` and inspect its structured output.

1. **Default workflows and permission inspection.** Query `GET /api/projects/default_project/agents/default_agent/auth`.
   - Observe: `role` is `"general"`, `availableAgentRoles` lists `none`, `readonly`, `general`, `general-with-ask`, `system-maintainer`, `admin`, and `full-permissions`, `unconditionalRoutes` lists the read and session maintenance routes, and `refinedRoutes` maps self-scoped routes (such as `agent.config.update` and `schedule.create`) to `["self"]`.
   - Screenshot: `s01-01-default-workflows.png`.
   - Counter-example: `availableAgentRoles` is missing one of the seven workflows, or `refinedRoutes` is empty under `general`.

2. **Controlled Agent session restrictions under `general`.** Create two Agents (`qa_runner` and `qa_peer`) and start a Session for `qa_runner`. Inside the Session, run `exec_command` to execute CLI and REST calls using the Session's injected `PENGUIN_API_TOKEN`:
   - Allowed under `general`: `penguin agent ls --json`, `GET /api/projects/default_project/agents/qa_runner/auth`, and `PUT /api/projects/default_project/agents/qa_runner/config` (own config via `agent.maintain@self`).
   - Denied by `@self` refiner: `PUT /api/projects/default_project/agents/qa_peer/config` returns HTTP 403 with `error.details.reason === "refiner_denied"` and `error.details.suggestedWithAsk` containing `"agent.maintain@withAsk"`.
   - Denied by missing role grant: `penguin config vault set --agent-id qa_runner --key TURN1_KEY --value secret` and `GET /api/admin/users` fail with HTTP 403 `role_missing_route_grant`, naming `requiredRoles`, `suggestedWithAsk`, `suggestedUpgradeGrants`, and `upgradeRequestEndpoint`.
   - Observe: quoted status codes, CLI exit codes, and the `error.details` object from both 403 responses.
   - Screenshot: `s02-01-general-restrictions.png`.
   - Counter-example: the Session receives the root admin token, cross-agent config modification succeeds, or the 403 response omits `suggestedWithAsk` and `upgradeRequestEndpoint`.

3. **Permission upgrade mode 1: `allowed_once`.** Have `qa_runner` post a permission upgrade request to `POST /api/projects/default_project/agents/qa_runner/auth/requests` with `grants: ["vault.maintain"]` and `routeId: "vault.setEntry"`. Approve it as admin via `POST .../requests/<requestId>/decide` with `{ "decision": "allowed_once" }`.
   - In the `qa_runner` Session, run `penguin config vault set --agent-id qa_runner --key ONCE_KEY_1 --value val1` twice in succession.
   - Observe: the first CLI command exits with `0` and saves `ONCE_KEY_1`; the second CLI command immediately fails with HTTP 403 (`role_missing_route_grant`) because the one-time grant was consumed.
   - Screenshot: `s03-01-allowed-once.png`.
   - Counter-example: the first call fails, or the second call still succeeds without a new approval.

4. **Permission upgrade mode 2: `allowed_for_agent`.** Have `qa_runner` request `grants: ["agent.maintain"]` (`routeId: "agent.config.update"`), and approve it with `{ "decision": "allowed_for_agent" }`.
   - In the `qa_runner` Session, call `PUT /api/projects/default_project/agents/qa_peer/config` twice, then inspect `GET /api/projects/default_project/agents/qa_runner/auth`.
   - Observe: both cross-agent updates return HTTP 200; `temporaryGrants.agentSessionGrants` contains `"agent.maintain"`, while persistent `apiIds` remains unchanged.
   - Screenshot: `s04-01-allowed-for-agent.png`.
   - Counter-example: the second call is blocked, or `"agent.maintain"` is written into the persistent `apiIds` array.

5. **Permission upgrade mode 3: `always_allowed`.** Have `qa_runner` request `grants: ["vault.maintain"]`, and approve it with `{ "decision": "always_allowed" }`.
   - In the `qa_runner` Session, run `penguin config vault set` for both `qa_runner` and `qa_peer`, and inspect `GET /api/projects/default_project/agents/qa_runner/auth`.
   - Observe: both CLI commands exit with `0`, and persistent `apiIds` now includes `"vault.maintain"`.
   - Screenshot: `s05-01-always-allowed.png`.
   - Counter-example: persistent `apiIds` does not include `"vault.maintain"`, or subsequent vault writes fail.

6. **Role mismatch detection and safe fallback on upgrade/downgrade.** Update `qa_peer`'s auth via `PUT /api/projects/default_project/agents/qa_peer/auth` with `{ "role": "deprecated-role-v1", "inherits": ["uninstalled_plugin.maintain", "obsolete.route@self"] }`.
   - Observe: HTTP 200 with `mismatches.hasMismatch === true`, `mismatches.unknownPrimaryRole === true`, `mismatches.fallbackRole === "readonly"`, `mismatches.unknownRoles` containing `"deprecated-role-v1"` and `"uninstalled_plugin.maintain"`, and `mismatches.unknownRoutes` containing `"obsolete.route"`.
   - Screenshot: `s06-01-role-mismatch-fallback.png`.
   - Counter-example: an unknown primary role escalates privileges or crashes route evaluation instead of falling back to `readonly`.

7. **Custom `AgentRole` definition (`defineRole`).** Send `PUT /api/projects/default_project/agents/qa_peer/auth` with a `defineRole` object (`id: "custom-reviewer"`, `inherits: ["readonly", "schedule.maintain@self"]`) and `role: "custom-reviewer"`.
   - Observe: HTTP 200 with `role === "custom-reviewer"` and `refinedRoutes["schedule.create"]` equal to `["self"]`.
   - Screenshot: `s07-01-custom-agent-role.png`.
   - Counter-example: the custom role is not listed in `availableAgentRoles` or its inherited `@self` refiner is lost.

## Record

In `<RUN>/usability/agent-auth/`: `report.html`, `shots/`, `evidence/` (JSON responses and turn probe reports with bearer tokens redacted), `oplog.md`, and `issues.md`.

## Done when

Every step from 1 to 7 has its evidence recorded in `evidence/` and a verdict in `report.html`, and any discrepancy is logged in `issues.md`.

## Never

- Read or print `.project_config.toml`, `agent_state/.vault.toml`, or `cli-session.json` in plain text.
- Record raw bearer tokens or session cookies in `report.html` or `evidence/`.
- Stop processes or touch data directories outside the run's scratch environment.
