# Unreleased

Changes since v0.1.4. The version number is assigned at release, when this folder is renamed.

- [2026-07-29] Core: every LLM failure except a rejected credential now retries inside the run — the classifier separating transient from permanent is an allowlist, so a gateway wording a transient fault its own way used to kill the turn — with the retry visible in both frontends, compaction on the same set under its own shorter budget, and a recovered failure no longer reported to the operator as an incident. Separately, pressing Stop mid-request can no longer leave a Session running forever when the provider's stream neither yields nor rejects after the abort. ([details](2026-07-29-llm-request-lifecycle.md))

- [2026-07-29] Cost center: the error table can page back through the whole history instead of showing only the newest 20, its source column reads `[env]` rather than `environment ·`, and an ordinary non-zero exit from a command tool is no longer recorded as an error — `grep` finding nothing had been crowding out the failures the table exists to show. ([details](2026-07-29-cost-center-errors.md))

- [2026-07-29] Core and tooling: `PORT` / `HOST` and the internal CLI plumbing no longer reach commands the Agent runs, so a dev server started by `exec_command` picks its own port instead of binding the harness's; and the development backend moves to 7368, so `pnpm dev` no longer collides with an installed `penguin web` — or, quieter and worse, proxies to it. ([details](2026-07-29-harness-env-and-dev-ports.md))

- [2026-07-29] Web App: the composer can attach files of any type — written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines, keeping non-ASCII names — and the `@` mention becomes an `/agent` command; both switch commands are session-only and stage their pick as a chip, cached with the text, until Enter sends. ([details](2026-07-29-composer-attachments-and-switch-commands.md))

- [2026-07-29] Core: the default system prompt is about a fifth shorter in the sections re-read every turn, now pins replies to the user's language, states the API-key stop rule once, points at parallel subagents for large tasks, and has skills install their tooling once into a shared per-Agent `shared_env/` directory while project dependencies stay in the project. Existing Agents keep their own prompt. ([details](2026-07-29-default-system-prompt.md))

- [2026-07-29] Web App: the chat header's elapsed chip no longer restarts from zero when a running Session is reloaded and now counts an event still in flight, and a round interrupted before its first Request settles to the same figure whether it was watched live or replayed — the running Task is anchored to the server's own clock instead of the browser's. ([details](2026-07-29-session-elapsed.md))

- [2026-07-28] Web App: model configuration stops inviting the browser's saved login — every form control opts out of autofill unless it declares a real credential role, and a secret field says `new-password`, the only value Chrome and Safari honor on a password box; a closed docked side panel no longer paints its 1px divider next to the open one, which read as a second, empty panel beside the Workspace files; a provider-signature message carrying no text stops drawing an empty reply bubble after a thinking segment; Benchmark costs now follow the display currency selected in settings; the tool card states a call's outcome once instead of twice; and no page can grow the document into a second scrollbar that drags the whole shell. ([details](2026-07-28-web-app.md))

- [2026-07-28] Web App and CLI: duration and byte abbreviations now carry into the next unit instead of printing `1m60s` or `1024KB` — both helpers rounded the value they displayed but chose the unit (or the minute/second split) from the raw input. ([details](2026-07-28-duration-and-byte-formatting.md))

- [2026-07-27] Windows: the `win32-x64` package bundles MinGit under `git/`, so `exec_command` has a real bash even on a machine with no Git for Windows — the shell stops depending on what happens to be installed. A user's own Git for Windows still wins (its MSYS userland is the fuller one); the bundle is the floor, and PowerShell is now reached only by npm installs. GPLv2 obligations are recorded in a new root `THIRD-PARTY-NOTICES.md`. ([details](2026-07-27-windows-bundled-shell.md))

- [2026-07-27] Sites: the 0.1.4 release post in both languages, with a capture script for its screenshots. ([details](2026-07-27-sites-and-blog.md))
