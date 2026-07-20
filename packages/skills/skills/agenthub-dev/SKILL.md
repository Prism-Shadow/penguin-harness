---
name: agenthub-dev
description: Fixed workflow for developing AgentHub itself — adding or updating model support. Use when asked to support a new model or protocol version in this repository, sync llmsdk_docs, or implement a provider client. Covers doc syncing, live API capture, paired Python/TypeScript implementation, and model-scoped e2e testing.
short_description: Add or update model support in AgentHub.
short_description_zh: 为 AgentHub 新增或更新模型支持。
version: 1
updated: 2026-07-20T12:00:00Z
---

# AgentHub Development Workflow

Adding or updating model support follows the stages below, in order. Where a stage says **stop and ask**, pause and ask the user; do not continue until the issue is resolved, and never fill the gap yourself.

## Before you start

If the user's message only invokes this skill (e.g. "use agenthub-dev skill") without a concrete request, ask the user which model or protocol to support and which stage to start from. Do not start any stage until the target is clear.

## Directory map

```
llmsdk_docs/<model_version>/      Official docs snapshot, one folder per model generation (README.md + docs/)
api_captures/<protocol>/          Git-ignored raw API captures: request payloads + stream events
src_py/agenthub/<protocol>/       Python client, one folder per wire protocol
src_py/agenthub/auto_client.py    Routes model names to protocol clients by explicit version
src_ts/src/<protocol>/            TypeScript client, mirrors the Python folder
src_ts/src/autoClient.ts          TypeScript routing, mirrors auto_client.py
src_py/tests/test_client.py       Parameterized e2e tests (env-gated AVAILABLE_MODELS)
src_ts/tests/client.test.ts       Same for TypeScript
changelog/                        One detail file per CHANGELOG.md entry
CHANGELOG.md                      Brief one-line entries linking into changelog/
```

## Stage 1 — Sync official docs into `llmsdk_docs/`

- Sources must be the model vendor's official documentation site (e.g. docs.anthropic.com, platform.openai.com, ai.google.dev). Never use third-party mirrors, blog posts, or model memory.
- Save the snapshot under `llmsdk_docs/<model_version>/` following the existing folder conventions, and list the folder in `llmsdk_docs/README.md`. Running this workflow is the explicit request that the repository rule against editing `llmsdk_docs/` asks for.
- When the fetched docs differ from an existing snapshot, the new official docs win: update the old files in place.
- The snapshot must be complete enough to implement from: request/response schemas, streaming event sequence, thinking output, tool calling, usage fields, and error responses.
- **Stop and ask** if the official URL is uncertain or a page cannot be fetched. The user can paste the content manually.

## Stage 2 — Capture a live API exchange into `api_captures/`

- Gate: the provider's API key environment variable must be set and usable. Use the same environment variables and base URLs as `src_py/tests/test_client.py` (`AVAILABLE_MODELS` gating and `_create_client`). **Stop and ask** the user to supply the key if it is missing; the workflow must not continue without it.
- Using the provider's official SDK, or raw HTTP exactly as documented, run one streaming tool-call request with thinking enabled, then send the tool result back so the capture also shows how assistant turns are re-sent.
- Save the complete exchange unmodified under `api_captures/<protocol>/` (git-ignored), e.g. `round1.request.json` plus `round1.stream.jsonl` with every raw stream event in order. Never save credentials.
- **Stop and ask** on any API error (invalid key, insufficient quota, rate limit). Do not mock the response or continue from docs alone.
- The capture is the primary implementation reference and outranks the docs: where they disagree, implement what the API actually returned.

## Stage 3 — Implement the Python and TypeScript clients

- One folder per wire protocol, named after the newest model generation that uses it. Diff the new protocol (capture + docs) against the closest existing folder:
  - Any difference between generations, even a single key name, means a separate folder per generation (e.g. `claude4_6/` vs `claude5/`).
  - Only an identical wire protocol may share a folder; name it after the newest generation (rename and reroute if needed). This is how `claude5/` serves Claude 4.7, 4.8, and 5.
- `auto_client.py` / `autoClient.ts` route model names by explicit version matching only, never a bare substring like `"claude" in model`.
- Conversion must be bijective: a wire message converted to `UniMessage`/`UniEvent` and back must reproduce the original exactly, including `fidelity` payloads (thinking signatures, phase labels, reasoning field names) and tool-call IDs. Verify against the captured exchange.
- `UniConfig` keys rarely map one-to-one onto provider config keys. **Stop and ask**: list every non-obvious mapping and confirm it with the user before coding. Never decide silently.
- Implement Python and TypeScript together with identical behavior.

## Stage 4 — Verify

- Register the model in the env-gated `AVAILABLE_MODELS` lists of both test files with correct capability flags. Do not add model-specific test functions or files.
- Static checks: `make lint` in `src_py/`; `npm run lint` and `npm run build` in `src_ts/`.
- Run only the new model's e2e tests; the full suites are slow and spend real API quota:
  - `cd src_py && uv run pytest -vvv tests/test_client.py -k "<model-name>"`
  - `cd src_ts && npm run test -- -t "<model-name>"`
- Leave unrelated tests to CI.

## Record and ship

- Write `changelog/YYYY-MM-DD-<slug>.md` with the specifics: protocol differences found, config mapping decisions, notable capture findings.
- Add one brief line at the top of `CHANGELOG.md` linking to that file. The root file keeps a single line per change.
- Commit on a feature branch and open a PR with `gh pr create --base dev`; direct pushes to `dev` are rejected.
