/**
 * Default PenguinHarness server port (internal shared constant; the barrel re-exports
 * only DEFAULT_SERVER_PORT, as the CLI `penguin server` / `penguin web` and server
 * default-port source of truth — previously each hardcoded the number). It is a
 * fallback only: the `--port` flag and the PORT environment variable override it at
 * runtime.
 */

/**
 * Port and data-root allocation across the repo (documented here because it is the one
 * place a reader looks for it; the dev ports themselves live in vite configs and
 * package.json scripts, neither of which can import this module):
 *
 * | port | who                                | data root                  | where                                |
 * | ---- | ---------------------------------- | -------------------------- | ------------------------------------ |
 * | 7364 | installed server / Web UI          | `~/.penguin/data`          | `DEFAULT_SERVER_PORT` below          |
 * | 7365 | `pnpm dev:web` (Vite)              | none (proxies to 7368)     | `packages/web/vite.config.ts`        |
 * | 7366 | `pnpm dev:landing` (Vite)          | none (static)              | `packages/landing/vite.config.ts`    |
 * | 7367 | `pnpm dev:docs` (Vite)             | none (static)              | `packages/docs/vite.config.ts`       |
 * | 7368 | `pnpm dev:server` (dev backend)    | `~/.penguin/dev-data`      | `packages/server/package.json` `dev` |
 * | 7369 | `pnpm penguin web` (dev CLI)       | `~/.penguin/dev-data-cli`  | the root and cli `penguin` scripts   |
 *
 * The desktop app binds no fixed port in either form (PORT=0 with a per-instance sticky
 * preference); its release form shares `~/.penguin/data` with the CLI by design and its
 * dev form takes `~/.penguin/dev-data` (see `packages/desktop/src/app-identity.ts`). The
 * web e2e harness runs on 8930/8931 against a throwaway root (`packages/web/e2e/run.sh`).
 *
 * The development backend deliberately does **not** share 7364 with an installed one: the
 * two are routinely running at once, and before they were split, `pnpm dev` either failed
 * to bind or -- worse -- the Vite proxy silently talked to the installed server instead of
 * the one being worked on. The dev data root is separated for the same reason.
 *
 * The dev CLI gets a third port rather than reusing the backend's 7368 because the two also
 * run at once: a harness started as `pnpm penguin web` is exactly what asks an Agent to run
 * `pnpm dev` in this repo, and sharing the number would reintroduce that collision one step
 * to the left -- `dev:server` failing to bind, or the Vite proxy answering from the harness.
 * Its data root is split from `dev-data` for the same reason as its port: a data root
 * admits one server at a time (`<root>/server.lock`), so on a shared root the Agent's
 * `dev:server` would refuse to start against the harness's own lock no matter how the
 * ports are laid out. The dev desktop shell deliberately stays on `dev-data`: a second
 * server on a locked root is its attach-mode case (the window opens the running
 * instance), not a startup failure, and sharing one dataset between `pnpm dev` and
 * `pnpm desktop` used alternately is the point of the common root.
 *
 * `packages/cli/test/dev-entry-isolation.test.ts` pins the pairwise disjointness of the
 * (port, root) pairs above.
 */

/** Default main server / Web UI port; deliberately avoids common defaults like 3000/8080. */
export const DEFAULT_SERVER_PORT = 7364;
