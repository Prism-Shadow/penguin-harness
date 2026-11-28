# The moved web halves stay scanned, exported and guarded

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-27-library-web-halves-guards.zh.md)

Follow-ups to the domains' move into their library packages (`changelog/unreleased/2026-11-24-library-web-halves.md`), so the app keeps the guarantees the move silently dropped:

- Tailwind's stylesheet scans `library/*/src/web` again — the moved pages get their utility classes (a capped scroll area, an offset timeline chart) back. The gallery's frames load the same stylesheet entry, so they are covered too.
- Each library package's `./web` exports name the files a deep path lands on, extension included. A package-declared subpath such as `@prismshadow/penguin-library-agent/web/agents/agent-settings-page` resolves again for consumers that go through the manifest.
- The model catalog enters the web build once: the app's imports of the server's `model-catalog` subpath resolve to the model package's catalog source, the same module its own files read, instead of a second compiled copy.
- The guards that walk the app's source walk the library web halves again — the module-boundary ratchet, the settings commit model, the menu look, the native-`title` and accessible-name checks and the modifier-key scan — and the web coverage report counts their files.
- The gallery's dev server reloads the sheets when a file is added in a library web half; the model-catalog maintenance guide points at the protocol-path file's new home.
