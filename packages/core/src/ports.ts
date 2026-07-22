/**
 * Reserved PenguinHarness service ports — the single source of truth for the default
 * ports our own services listen on.
 *
 * The CLI (`penguin server` / `penguin web`) and the server derive their default port
 * from here; these are fallbacks only — the `--port` flag and the PORT environment
 * variable still override them at runtime. The vite dev configs (packages/web|landing|docs)
 * cannot import core TS, so they hardcode the same numbers with a comment pointing back
 * at this file.
 */

/** Default main server / Web UI port (`penguin server` / `penguin web`; deliberately avoids common defaults like 3000/8080). */
export const DEFAULT_SERVER_PORT = 7364;

/** Default ports of PenguinHarness's own services; never kill their listeners or reuse the ports for other servers. */
export const RESERVED_PORTS: readonly number[] = [
  DEFAULT_SERVER_PORT, // main server / Web UI
  7365, // web dev server (packages/web/vite.config.ts; proxies /api to the main server)
  7366, // landing dev server (packages/landing/vite.config.ts)
  7367, // docs dev server (packages/docs/vite.config.ts)
];
