# Coding-agent saves reach the server as JSON objects

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `web`, `coding-agents`

## Details

- Every mutating coding-agents call from the Web App (save definition, create session, prompt, permission answer, mode switch) sent a doubly-stringified body: the endpoint wrapper serialized the payload and `apiFetch` serialized it again, so the server received a JSON string and answered 400 "Request body must be a JSON object." The wrappers now pass the payload object, like every other endpoint; saving an agent from the Add-agent dialog works.
- On Windows, command resolution no longer resolves a bare name to an extensionless PATH match (npm's POSIX shims, fnm's per-shell multishell dirs) — those files cannot be spawned, and the multishell path dies with the shell that created it. Discovery now falls through to the spawnable `.cmd` twin elsewhere on PATH; a name that spells its own dot still resolves by exact match.
