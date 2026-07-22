/**
 * Reserved PenguinHarness service ports — the single source of truth for the ports our
 * own services listen on.
 *
 * The CLI (`penguin server` / `penguin web`) and the server derive their default port
 * from here. The vite dev configs (packages/web|landing|docs) cannot import core TS, so
 * they hardcode the same numbers with a comment pointing back at this file. The full
 * list is interpolated into the default system prompt so agents never kill processes
 * listening on these ports.
 */

/** Default main server / Web UI port (`penguin server` / `penguin web`; deliberately avoids common defaults like 3000/8080). */
export const DEFAULT_SERVER_PORT = 7364;

/** Ports reserved for PenguinHarness's own services; never kill their listeners to free a port. */
export const RESERVED_PORTS: readonly number[] = [
  DEFAULT_SERVER_PORT, // main server / Web UI
  7365, // web dev server (packages/web/vite.config.ts; proxies /api to the main server)
  7366, // landing dev server (packages/landing/vite.config.ts)
  7367, // docs dev server (packages/docs/vite.config.ts)
];
