/**
 * Default PenguinHarness server port (internal shared constant; the barrel re-exports
 * only DEFAULT_SERVER_PORT, as the CLI `penguin server` / `penguin web`, the server and
 * the desktop shell's embedded server all read their default from here).
 *
 * It is a well-known number on purpose, not merely a fallback: a client — the desktop
 * shell, or a session reaching a machine through an SSH tunnel — finds "the server for
 * this user" by probing this one port, and offers to install one when nothing answers.
 * The cost is deliberate: ONE server per user per machine by default, since a second
 * instance would collide. Running two takes an explicit `--port` / `PORT` override, and
 * the tunnel case needs the local port to equal the remote one anyway (preview URLs are
 * built from the server's own bound port).
 */

/**
 * Port allocation across the repo (documented here because it is the one place a reader
 * looks for it; the dev ports themselves live in vite configs and package.json scripts,
 * neither of which can import this module):
 *
 * | port | who                                | where                                       |
 * | ---- | ---------------------------------- | ------------------------------------------- |
 * | 7376 | installed server / Web UI / desktop| `DEFAULT_SERVER_PORT` below                 |
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

/**
 * The well-known main server / Web UI port; deliberately avoids common defaults like
 * 3000/8080. Was 7364 through 0.2.2, when it was only a default and the desktop shell
 * bound an ephemeral port instead; it moved with the switch to one probed, fixed address.
 */
export const DEFAULT_SERVER_PORT = 7376;
