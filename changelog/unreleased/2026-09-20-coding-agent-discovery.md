# Coding-agent discovery on the server

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`
- **PR:** [#25](https://github.com/nicolaepocroianu/penguin-harness/pull/25)

The coding-agents "Add agent" dialog now probes the server machine for known agents and offers them as one-click pre-fills. Detection is filesystem-only: the server walks PATH plus the version-manager install homes a server process's PATH usually misses (volta, asdf, mise, bun, npm/pnpm globals) and spawns nothing to do it.

## Details

- New admin endpoint `GET /api/coding-agents/discover` returns one candidate per known recipe (Gemini CLI, Claude Code, Codex CLI): whether the agent's CLI was found, a runnable ACP entrypoint resolved to an absolute command, an auth hint, and whether a definition with that id already exists.
- The recipe table separates the CLI that proves installation from the ACP entrypoint: Claude Code and Codex drive through adapter packages (`claude-agent-acp`, `@zed-industries/codex-acp`), offered directly when installed and via `npx` otherwise; Gemini CLI speaks ACP natively (`--experimental-acp`).
- The dialog lists detected recipes first with a Use button that pre-fills the definition form; installed agents missing their adapter name the install command; undetected ones dim and link their homepage.
- On Windows, `.cmd`/`.bat` agent commands (npm shims such as `gemini` or `npx`) are spawned through `cmd.exe` — Node refuses them without a shell, so most npm-installed agents could not start at all. Definitions are admin-authored, so the shell's metacharacter handling is trusted the same way typing the command into a shell is.
- Session spawn resolves bare command names against PATH and those install dirs before spawning; unknown names fail exactly as before.
