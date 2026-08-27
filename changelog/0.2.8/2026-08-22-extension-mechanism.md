# An extension mechanism: one entry point, two typed events

- **Date:** 2026-08-22
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#353](https://github.com/Prism-Shadow/penguin-harness/pull/353)

[中文版](2026-08-22-extension-mechanism.zh.md)

The harness gained an extension seam. An extension package exports one function — `activate(ctx)` — which the server runs once per process while reading `<root>/extensions.json`, before any App exists. Everything after that arrives as typed events: `"initialize"` hands over the definition view, where an extension registers workflow factories, and `"create"` hands over the assembled instance view. Both fire at every App creation, so a hot swap re-delivers them and an extension's registrations can never be seeded into an instance that has been replaced.

## Details

- Which extensions a deployment runs is configuration, not capability compiled into the platform: `<root>/extensions.json` lists package specifiers, each resolved against the installation rather than the platform bundle, so installing or upgrading one is an install-side action. An absent file means no extensions; a file that exists but cannot be read, or is malformed, fails the boot rather than presenting as a healthy server with every configured capability silently missing. An unresolvable entry, a module without an `activate` export, or a failing `activate` is reported and skipped per entry — and whatever that `activate` had already registered for cleanup runs before it is dropped.
- Extension loading runs after the single-instance pre-check, so a process about to exit with code 3 never imports third-party modules and never runs their top-level side effects.
- `ExtensionEvents` maps each event name to its payload — the one place the event vocabulary lives, so adding an event types the platform's emit and every extension's handler together.
- `activate` may be async and is awaited. Subscriptions and `ctx.disposables` are sealed once it settles; a later `on(...)` throws. Event handlers stay synchronous — one that returns a promise is refused, because an App is assembled synchronously around the emit and the rejection could only escape unhandled. A duplicate workflow name is refused too, so ownership never depends on `extensions.json` ordering. Disposables may be async, run concurrently at shutdown with failures isolated, and are awaited under the same 5-second budget as the session manager's wrap-up.
- Workflows are registration plus a plain function call — no Session, no approval, no streaming. Every registered factory is instantiated once per App, in one batch after registration closes.
- The contract an extension package compiles against is declared in the SDK, at `@prismshadow/penguin-core/extension`. `PenguinContext` and `PenguinInterface` are open: the harness contributes the members it owns by augmenting that module, and re-exports both halves from `@prismshadow/penguin-server/extension`. Both subpaths carry no runtime code, so an extension stays a self-contained library.
- The server's boot order, each subsystem's external surface, and the extension lifecycle are documented on a new Server boot page (`packages/docs/content/server-boot.en.md`).
