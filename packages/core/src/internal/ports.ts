/**
 * Default PenguinHarness server port (internal shared constant; the barrel re-exports
 * only DEFAULT_SERVER_PORT, as the CLI `penguin server` / `penguin web` and server
 * default-port source of truth — previously each hardcoded the number). It is a
 * fallback only: the `--port` flag and the PORT environment variable override it at
 * runtime.
 */

/**
 * Port allocation across the repo (documented here because it is the one place a reader
 * looks for it; the dev ports themselves live in vite configs and package.json scripts,
 * neither of which can import this module):
 *
 * | port | who                                | where                                       |
 * | ---- | ---------------------------------- | ------------------------------------------- |
 * | 7364 | installed server / Web UI          | `DEFAULT_SERVER_PORT` below                 |
 * | 7365 | `pnpm dev:web` (Vite)              | `packages/web/vite.config.ts`               |
 * | 7366 | `pnpm dev:landing` (Vite)          | `packages/landing/vite.config.ts`           |
 * | 7367 | `pnpm dev:docs` (Vite)             | `packages/docs/vite.config.ts`              |
 * | 7368 | `pnpm dev:server` (dev backend)    | `packages/server/package.json` `dev`        |
 * | 7369 | `pnpm penguin web` (dev CLI)       | the root and cli `penguin` scripts          |
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
 */

/** Default main server / Web UI port; deliberately avoids common defaults like 3000/8080. */
export const DEFAULT_SERVER_PORT = 7364;
