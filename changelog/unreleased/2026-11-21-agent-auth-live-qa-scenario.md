# Add end-to-end live LLM QA test suite and usability scenario for Agent authorization

- **Date:** 2026-11-21
- **Type:** change
- **Scope:** `server`, `tests/scenarios`

[中文版](2026-11-21-agent-auth-live-qa-scenario.zh.md)

Added the end-to-end live LLM QA test suite (`packages/server/test/agent-auth-live-qa.e2e.test.ts`) and usability scenario (`tests/scenarios/usability/agent-auth/`) verifying Agent authorization roles, `@self` and `@withAsk` refiners, role mismatch fallback, and the three permission upgrade approval decisions (`allowed_once`, `allowed_for_agent`, `always_allowed`).

## Details

- Added `packages/server/test/agent-auth-live-qa.e2e.test.ts` driving real Agent sessions against a live server across all seven default workflow roles, `@self` isolation, role mismatch fallback to `readonly`, and the three permission upgrade approval modes.
- Added `tests/scenarios/usability/agent-auth/TASK.md` and `tests/scenarios/usability/agent-auth/scripts/verify-agent-auth.mjs` and registered `usability/agent-auth` in `tests/scenarios/README.md`.
